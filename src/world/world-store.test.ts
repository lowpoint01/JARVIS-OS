import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorldStore } from "./world-store.js";

async function withStore<T>(fn: (store: WorldStore) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-world-"));
  try {
    const store = new WorldStore(path.join(dir, "world.json"));
    await store.initialize();
    return await fn(store);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("WorldStore", () => {
  it("upserts and finds entities", async () => {
    await withStore(async (store) => {
      await store.upsertEntity({
        type: "project",
        name: "JARVIS-OS",
        summary: "Local personal AI operating layer",
        tags: ["assistant"],
      });

      const matches = store.findEntities("assistant");

      expect(matches).toHaveLength(1);
      expect(matches[0]?.name).toBe("JARVIS-OS");
    });
  });

  it("links entities with relations", async () => {
    await withStore(async (store) => {
      const project = await store.upsertEntity({ type: "project", name: "JARVIS-OS" });
      const service = await store.upsertEntity({ type: "service", name: "Gateway" });
      const relation = await store.addRelation({
        fromId: project.id,
        toId: service.id,
        type: "runs",
      });

      expect(relation.type).toBe("runs");
      expect(store.listRelations(project.id)).toHaveLength(1);
    });
  });

  it("deletes tagged synthetic entities and their relations", async () => {
    await withStore(async (store) => {
      const project = await store.upsertEntity({
        type: "project",
        name: "Full Check Project",
        tags: ["full-check"],
      });
      const service = await store.upsertEntity({
        type: "service",
        name: "Full Check Service",
        tags: ["full-check"],
      });
      await store.addRelation({ fromId: project.id, toId: service.id, type: "verifies" });

      const deleted = await store.deleteEntitiesByTag("full-check");

      expect(deleted).toEqual({ entitiesDeleted: 2, relationsDeleted: 1 });
      expect(store.snapshot()).toEqual({ entities: [], relations: [] });
    });
  });
});
