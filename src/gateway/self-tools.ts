import type { SelfDiagnosticReport } from "../self/self-diagnostics.js";
import type { SelfAwarenessReport } from "../self/self-model.js";
import type { ToolDefinition } from "../shared/types.js";

export function buildSelfTools(params: {
  diagnose: () => Promise<SelfDiagnosticReport>;
  model: () => Promise<SelfAwarenessReport>;
}): ToolDefinition[] {
  return [
    {
      name: "self.diagnose",
      description: "Run a lightweight self-diagnostic report for JARVIS-OS.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => await params.diagnose(),
    },
    {
      name: "self.model",
      description: "Read JARVIS-OS self-awareness model: posture, capabilities, constraints, risks, and next actions.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => await params.model(),
    },
  ];
}
