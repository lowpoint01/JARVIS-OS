import { describe, expect, it } from "vitest";
import { decideInitiative } from "./initiative-score.js";

describe("Initiative scoring", () => {
  it("stays silent when value is low and interruption cost is high", () => {
    const decision = decideInitiative({
      importance: 0.1,
      urgency: 0.1,
      relevance: 0.2,
      actionability: 0.1,
      successProbability: 0.5,
      interruptionCost: 0.9,
      riskCost: 0.2,
      uncertainty: 0.5,
    });
    expect(decision.level).toBe("A0_SILENT_OBSERVE");
  });

  it("asks for confirmation when value is useful but risk is high", () => {
    const decision = decideInitiative({
      importance: 0.95,
      urgency: 0.8,
      relevance: 0.9,
      actionability: 0.9,
      successProbability: 0.8,
      interruptionCost: 0.1,
      riskCost: 0.8,
      uncertainty: 0.2,
    });
    expect(decision.level).toBe("A5_CONFIRM_EXECUTE");
  });

  it("allows reversible execution for high-value low-risk situations", () => {
    const decision = decideInitiative({
      importance: 1,
      urgency: 1,
      relevance: 1,
      actionability: 1,
      successProbability: 0.95,
      interruptionCost: 0,
      riskCost: 0,
      uncertainty: 0,
    });
    expect(decision.level).toBe("A4_REVERSIBLE_EXECUTE");
  });
});
