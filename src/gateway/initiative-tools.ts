import type { ActiveLoop } from "../initiative/active-loop.js";
import type { ToolDefinition } from "../shared/types.js";

export function buildInitiativeTools(activeLoop: ActiveLoop): ToolDefinition[] {
  return [
    {
      name: "initiative.status",
      description: "Read proactive loop status, latest decision, and latest plan.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => activeLoop.status(),
    },
    {
      name: "initiative.tick",
      description: "Run one proactive loop tick immediately.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => ({
        decision: await activeLoop.tick(),
        status: activeLoop.status(),
      }),
    },
  ];
}
