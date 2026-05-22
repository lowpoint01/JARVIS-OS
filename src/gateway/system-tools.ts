import os from "node:os";
import type { ToolDefinition } from "../shared/types.js";
import type { ModelRouter } from "../model-router/model-router.js";
import type { JsonlEventStore } from "../events/event-store.js";
import { decideInitiative, type InitiativeSignal } from "../initiative/initiative-score.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function buildSystemTools(params: {
  startedAt: number;
  modelRouter: ModelRouter;
  eventStore: JsonlEventStore;
}): ToolDefinition[] {
  return [
    {
      name: "system.health",
      description: "Read JARVIS-OS local runtime health.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => ({
        uptimeMs: Date.now() - params.startedAt,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        memory: {
          free: os.freemem(),
          total: os.totalmem(),
        },
        models: params.modelRouter.status(),
      }),
    },
    {
      name: "events.recent",
      description: "Read recent JARVIS-OS events.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const limit =
          input && typeof input === "object" && "limit" in input && typeof input.limit === "number"
            ? input.limit
            : 20;
        return await params.eventStore.recent(limit);
      },
    },
    {
      name: "model.status",
      description: "Read configured model providers, keys, routing mode, probes, and latency windows.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => params.modelRouter.status(),
    },
    {
      name: "model.probe",
      description: "Run a live chat and embedding probe against the configured model providers.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => await params.modelRouter.probe(),
    },
    {
      name: "model.chat",
      description: "Send a message to the configured strong chat model.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.message !== "string") {
          throw new Error("model.chat requires { message: string }.");
        }
        return await params.modelRouter.chat({ message: body.message });
      },
    },
    {
      name: "embedding.embed",
      description: "Create an embedding with the configured vector model.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.text !== "string") {
          throw new Error("embedding.embed requires { text: string }.");
        }
        const result = await params.modelRouter.embed(body.text);
        return {
          provider: result.provider,
          model: result.model,
          dimensions: result.dimensions,
          preview: result.embedding.slice(0, 8),
        };
      },
    },
    {
      name: "initiative.decide",
      description: "Score a situation and decide the proactive action level.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const signal: InitiativeSignal = {
          importance: Number(body?.importance ?? 0),
          urgency: Number(body?.urgency ?? 0),
          relevance: Number(body?.relevance ?? 0),
          actionability: Number(body?.actionability ?? 0),
          successProbability: Number(body?.successProbability ?? 0),
          interruptionCost: Number(body?.interruptionCost ?? 0),
          riskCost: Number(body?.riskCost ?? 0),
          uncertainty: Number(body?.uncertainty ?? 0),
        };
        return decideInitiative(signal);
      },
    },
  ];
}
