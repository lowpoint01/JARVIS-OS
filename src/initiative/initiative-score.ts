export type InitiativeSignal = {
  importance: number;
  urgency: number;
  relevance: number;
  actionability: number;
  successProbability: number;
  interruptionCost: number;
  riskCost: number;
  uncertainty: number;
};

export type InitiativeDecisionLevel =
  | "A0_SILENT_OBSERVE"
  | "A1_AUTO_MEMORY"
  | "A2_BACKGROUND_PREPARE"
  | "A3_PROACTIVE_NOTIFY"
  | "A4_REVERSIBLE_EXECUTE"
  | "A5_CONFIRM_EXECUTE";

export type InitiativeDecision = {
  score: number;
  level: InitiativeDecisionLevel;
  reason: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function calculateInitiativeScore(signal: InitiativeSignal): number {
  const score =
    clamp01(signal.importance) * 0.3 +
    clamp01(signal.urgency) * 0.2 +
    clamp01(signal.relevance) * 0.2 +
    clamp01(signal.actionability) * 0.15 +
    clamp01(signal.successProbability) * 0.1 -
    clamp01(signal.interruptionCost) * 0.25 -
    clamp01(signal.riskCost) * 0.3 -
    clamp01(signal.uncertainty) * 0.2;

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

export function decideInitiative(signal: InitiativeSignal): InitiativeDecision {
  const score = calculateInitiativeScore(signal);
  const risk = clamp01(signal.riskCost);
  const uncertainty = clamp01(signal.uncertainty);

  if (score < 0.18) {
    return { score, level: "A0_SILENT_OBSERVE", reason: "low initiative value" };
  }
  if (score < 0.32) {
    return { score, level: "A1_AUTO_MEMORY", reason: "worth remembering, not worth interrupting" };
  }
  if (score < 0.52) {
    return { score, level: "A2_BACKGROUND_PREPARE", reason: "prepare quietly before interrupting" };
  }
  if (risk > 0.55 || uncertainty > 0.55) {
    return {
      score,
      level: "A5_CONFIRM_EXECUTE",
      reason: "valuable but needs confirmation because risk or uncertainty is high",
    };
  }
  if (score < 0.72) {
    return { score, level: "A3_PROACTIVE_NOTIFY", reason: "useful enough to notify" };
  }
  return { score, level: "A4_REVERSIBLE_EXECUTE", reason: "high value and low enough risk" };
}
