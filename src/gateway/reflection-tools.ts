import type { ReflectionKind, ReflectionStore } from "../reflection/reflection-store.js";
import type { ToolDefinition } from "../shared/types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function asKind(value: unknown): ReflectionKind | undefined {
  return typeof value === "string" &&
    ["success", "failure", "lesson", "policy_suggestion"].includes(value)
    ? (value as ReflectionKind)
    : undefined;
}

export function buildReflectionTools(reflectionStore: ReflectionStore): ToolDefinition[] {
  return [
    {
      name: "reflection.record",
      description: "Record a durable lesson, failure, success, or policy suggestion.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.title !== "string" || typeof body.summary !== "string") {
          throw new Error("reflection.record requires { title: string, summary: string }.");
        }
        return await reflectionStore.record({
          kind: asKind(body.kind),
          title: body.title,
          summary: body.summary,
          tags: asStringArray(body.tags),
          sourceEventId: typeof body.sourceEventId === "string" ? body.sourceEventId : undefined,
          confidence: typeof body.confidence === "number" ? body.confidence : undefined,
          metadata: asRecord(body.metadata),
        });
      },
    },
    {
      name: "reflection.list",
      description: "List recent durable reflections.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const limit = typeof body?.limit === "number" ? body.limit : 50;
        return reflectionStore.list(limit, asKind(body?.kind));
      },
    },
    {
      name: "reflection.find",
      description: "Search durable reflections and lessons.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const query = typeof body?.query === "string" ? body.query : "";
        const limit = typeof body?.limit === "number" ? body.limit : 10;
        return reflectionStore.find(query, limit);
      },
    },
  ];
}
