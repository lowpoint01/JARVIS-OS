import type { PerceptionLoop } from "../perception/perception-loop.js";
import type { ToolDefinition } from "../shared/types.js";

export function buildPerceptionTools(perceptionLoop: PerceptionLoop): ToolDefinition[] {
  return [
    {
      name: "perception.status",
      description: "Read the current local perception loop and system resource sample.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => perceptionLoop.status(),
    },
  ];
}
