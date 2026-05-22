import type { JarvisConfig } from "../shared/types.js";
import type { RiskLevel, ToolDefinition, ToolCallResult } from "../shared/types.js";

export class SafetyKernel {
  constructor(private readonly config: JarvisConfig["safety"]) {}

  evaluate(tool: ToolDefinition): { status: "allow" | "confirm" | "block"; riskLevel: RiskLevel } {
    const riskLevel = tool.riskLevel;
    if (this.config.blockLevels.includes(riskLevel)) {
      return { status: "block", riskLevel };
    }
    if (tool.requiresConfirmation || this.config.confirmLevels.includes(riskLevel)) {
      return { status: "confirm", riskLevel };
    }
    if (this.config.autoAllowLevels.includes(riskLevel)) {
      return { status: "allow", riskLevel };
    }
    return { status: "confirm", riskLevel };
  }

  blockedResult(tool: ToolDefinition): ToolCallResult {
    return {
      ok: false,
      status: "blocked",
      riskLevel: tool.riskLevel,
      error: `Tool ${tool.name} is blocked by safety policy (${tool.riskLevel}).`,
    };
  }

  confirmationResult(tool: ToolDefinition): ToolCallResult {
    return {
      ok: false,
      status: "needs_confirmation",
      riskLevel: tool.riskLevel,
      error: `Tool ${tool.name} requires confirmation before execution (${tool.riskLevel}).`,
    };
  }
}
