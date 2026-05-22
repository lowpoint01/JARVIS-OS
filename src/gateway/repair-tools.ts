import type { SelfDiagnosticReport } from "../self/self-diagnostics.js";
import { buildSelfRepairPlan, runSelfPreflight } from "../self/self-repair.js";
import type { ToolDefinition } from "../shared/types.js";

export function buildRepairTools(params: {
  rootDir: string;
  diagnose: () => Promise<SelfDiagnosticReport>;
}): ToolDefinition[] {
  return [
    {
      name: "self.preflight",
      description: "Run safe local preflight checks before upgrades or repairs.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => await runSelfPreflight(params),
    },
    {
      name: "self.repair_plan",
      description: "Generate a conservative repair plan from preflight checks without applying changes.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => buildSelfRepairPlan(await runSelfPreflight(params)),
    },
  ];
}
