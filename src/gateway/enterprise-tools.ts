import type { EnterpriseReadinessReport } from "../enterprise/readiness.js";
import type { ToolDefinition } from "../shared/types.js";

export function buildEnterpriseTools(params: {
  readiness: () => Promise<EnterpriseReadinessReport>;
}): ToolDefinition[] {
  return [
    {
      name: "enterprise.readiness",
      description:
        "Generate the enterprise readiness report: service, model, memory, tools, safety, storage, observability, voice, and runtime loops.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => await params.readiness(),
    },
  ];
}
