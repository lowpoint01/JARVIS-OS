import type { ToolDefinition } from "../shared/types.js";
import {
  WORLD_ENTITY_TYPES,
  type UpsertWorldEntityInput,
  type WorldEntityType,
  type WorldStore,
} from "../world/world-store.js";

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

function asEntityType(value: unknown): WorldEntityType | undefined {
  return typeof value === "string" && WORLD_ENTITY_TYPES.includes(value as WorldEntityType)
    ? (value as WorldEntityType)
    : undefined;
}

export function buildWorldTools(worldStore: WorldStore): ToolDefinition[] {
  return [
    {
      name: "world.upsert_entity",
      description: "Create or update a durable world-model entity.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.name !== "string") {
          throw new Error("world.upsert_entity requires { name: string }.");
        }
        const payload: UpsertWorldEntityInput = {
          id: typeof body.id === "string" ? body.id : undefined,
          type: asEntityType(body.type),
          name: body.name,
          aliases: asStringArray(body.aliases),
          summary: typeof body.summary === "string" ? body.summary : undefined,
          tags: asStringArray(body.tags),
          attributes: asRecord(body.attributes),
          confidence: typeof body.confidence === "number" ? body.confidence : undefined,
        };
        return await worldStore.upsertEntity(payload);
      },
    },
    {
      name: "world.find",
      description: "Find project, device, service, file, person, or custom entities.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const query = typeof body?.query === "string" ? body.query : "";
        const limit = typeof body?.limit === "number" ? body.limit : 10;
        return worldStore.findEntities(query, limit);
      },
    },
    {
      name: "world.link",
      description: "Create a durable relationship between two world-model entities.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (
          typeof body?.fromId !== "string" ||
          typeof body.toId !== "string" ||
          typeof body.type !== "string"
        ) {
          throw new Error("world.link requires { fromId: string, toId: string, type: string }.");
        }
        return await worldStore.addRelation({
          fromId: body.fromId,
          toId: body.toId,
          type: body.type,
          confidence: typeof body.confidence === "number" ? body.confidence : undefined,
          metadata: asRecord(body.metadata),
        });
      },
    },
    {
      name: "world.snapshot",
      description: "Read the current world-model entities and relationships.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => worldStore.snapshot(),
    },
  ];
}
