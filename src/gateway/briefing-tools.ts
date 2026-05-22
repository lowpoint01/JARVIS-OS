import type { BriefingReport } from "../briefing/briefing.js";
import type { ToolDefinition } from "../shared/types.js";

export function buildBriefingTools(params: {
  generate: () => Promise<BriefingReport>;
}): ToolDefinition[] {
  return [
    {
      name: "briefing.generate",
      description: "Generate a deterministic situational briefing for proactive JARVIS operation.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => await params.generate(),
    },
  ];
}
