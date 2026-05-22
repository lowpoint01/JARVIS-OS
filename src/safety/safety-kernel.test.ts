import { describe, expect, it } from "vitest";
import { SafetyKernel } from "./safety-kernel.js";
import type { ToolDefinition } from "../shared/types.js";

function tool(riskLevel: ToolDefinition["riskLevel"]): ToolDefinition {
  return {
    name: `tool.${riskLevel}`,
    description: "test",
    riskLevel,
    requiresConfirmation: false,
    canRollback: false,
    handler: async () => ({}),
  };
}

describe("SafetyKernel", () => {
  it("allows low-risk tools", () => {
    const kernel = new SafetyKernel({
      autoAllowLevels: ["L0", "L1"],
      confirmLevels: ["L2", "L3"],
      blockLevels: ["L4"],
    });
    expect(kernel.evaluate(tool("L0")).status).toBe("allow");
    expect(kernel.evaluate(tool("L1")).status).toBe("allow");
  });

  it("requires confirmation for medium-risk tools", () => {
    const kernel = new SafetyKernel({
      autoAllowLevels: ["L0", "L1"],
      confirmLevels: ["L2", "L3"],
      blockLevels: ["L4"],
    });
    expect(kernel.evaluate(tool("L2")).status).toBe("confirm");
    expect(kernel.evaluate(tool("L3")).status).toBe("confirm");
  });

  it("blocks critical tools by default", () => {
    const kernel = new SafetyKernel({
      autoAllowLevels: ["L0", "L1"],
      confirmLevels: ["L2", "L3"],
      blockLevels: ["L4"],
    });
    expect(kernel.evaluate(tool("L4")).status).toBe("block");
  });
});
