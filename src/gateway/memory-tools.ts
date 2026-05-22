import type {
  MemoryKind,
  MemoryRecallInput,
  MemoryStoreInput,
  VectorMemoryStore,
} from "../memory/vector-memory-store.js";
import { extractMemoryCandidates } from "../memory/memory-intake.js";
import { MEMORY_KINDS } from "../memory/vector-memory-store.js";
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

function asMemoryKind(value: unknown): MemoryKind | undefined {
  return typeof value === "string" && MEMORY_KINDS.includes(value as MemoryKind)
    ? (value as MemoryKind)
    : undefined;
}

function asMetadata(value: unknown): Record<string, unknown> | undefined {
  return asRecord(value);
}

export function buildMemoryTools(memoryStore: VectorMemoryStore): ToolDefinition[] {
  return [
    {
      name: "memory.store",
      description: "Persist a long-term memory with vector embedding and duplicate control.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.text !== "string") {
          throw new Error("memory.store requires { text: string }.");
        }
        const payload: MemoryStoreInput = {
          text: body.text,
          kind: asMemoryKind(body.kind),
          scope: typeof body.scope === "string" ? body.scope : undefined,
          tags: asStringArray(body.tags),
          importance: typeof body.importance === "number" ? body.importance : undefined,
          confidence: typeof body.confidence === "number" ? body.confidence : undefined,
          source: typeof body.source === "string" ? body.source : "tool",
          metadata: asMetadata(body.metadata),
        };
        return await memoryStore.store(payload);
      },
    },
    {
      name: "memory.recall",
      description: "Recall relevant long-term memories with semantic vector search.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.query !== "string") {
          throw new Error("memory.recall requires { query: string }.");
        }
        const payload: MemoryRecallInput = {
          query: body.query,
          topK: typeof body.topK === "number" ? body.topK : undefined,
          minScore: typeof body.minScore === "number" ? body.minScore : undefined,
          scope: typeof body.scope === "string" ? body.scope : undefined,
          kind: asMemoryKind(body.kind),
        };
        return await memoryStore.recall(payload);
      },
    },
    {
      name: "memory.recent",
      description: "Read recent long-term memory records without exposing raw vectors.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const limit = typeof body?.limit === "number" ? body.limit : 20;
        return await memoryStore.recent(limit);
      },
    },
    {
      name: "memory.extract",
      description: "Extract long-term memory candidates from a message without storing them.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.message !== "string") {
          throw new Error("memory.extract requires { message: string }.");
        }
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "main";
        return extractMemoryCandidates(body.message, sessionId);
      },
    },
    {
      name: "memory.vault_status",
      description: "Read durable Markdown memory vault mirror status.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => memoryStore.vaultStatus(),
    },
  ];
}
