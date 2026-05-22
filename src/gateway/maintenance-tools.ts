import type { ReflectionStore } from "../reflection/reflection-store.js";
import type { ToolDefinition } from "../shared/types.js";
import type { VectorMemoryStore } from "../memory/vector-memory-store.js";
import type { WorldStore } from "../world/world-store.js";

export function buildMaintenanceTools(params: {
  memoryStore: VectorMemoryStore;
  worldStore: WorldStore;
  reflectionStore: ReflectionStore;
}): ToolDefinition[] {
  return [
    {
      name: "maintenance.status",
      description: "Read lightweight local data-maintenance counters.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => ({
        memoryRecords: params.memoryStore.count(),
        worldEntities: params.worldStore.countEntities(),
        worldRelations: params.worldStore.countRelations(),
        reflectionRecords: params.reflectionStore.count(),
        memoryVault: params.memoryStore.vaultStatus(),
      }),
    },
    {
      name: "maintenance.prune_full_check",
      description: "Remove only synthetic full-check artifacts from memory, world model, and reflections.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => {
        const memory = await params.memoryStore.deleteWhere({
          scope: "full-check",
          tag: "full-check",
          source: "full-check",
        });
        const world = await params.worldStore.deleteEntitiesByTag("full-check");
        const reflections = await params.reflectionStore.deleteSyntheticFullCheck();
        const boundaryReflections = await params.reflectionStore.deleteExpectedBoundaryFailures();
        return {
          memoryDeleted: memory.deleted,
          worldEntitiesDeleted: world.entitiesDeleted,
          worldRelationsDeleted: world.relationsDeleted,
          reflectionsDeleted: reflections.deleted + boundaryReflections.deleted,
          boundaryReflectionsDeleted: boundaryReflections.deleted,
        };
      },
    },
  ];
}
