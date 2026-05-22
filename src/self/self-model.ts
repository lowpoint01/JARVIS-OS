import type { SelfDiagnosticReport } from "./self-diagnostics.js";
import type { SelfPreflightReport, SelfRepairPlan } from "./self-repair.js";

export type SelfPosture = "ready" | "watch" | "repair_needed";

export type SelfCapability = {
  name: string;
  status: "online" | "degraded" | "offline";
  detail: string;
};

export type SelfAwarenessReport = {
  generatedAt: number;
  identity: {
    name: string;
    role: string;
    operatingMode: "local_control_plane";
  };
  posture: SelfPosture;
  summary: string;
  stabilityScore: number;
  capabilities: SelfCapability[];
  constraints: string[];
  risks: string[];
  nextActions: string[];
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function capability(
  name: string,
  ok: boolean,
  detail: string,
  degraded = false,
): SelfCapability {
  return {
    name,
    status: ok ? (degraded ? "degraded" : "online") : "offline",
    detail,
  };
}

function postureFor(diagnostic: SelfDiagnosticReport, preflight: SelfPreflightReport): SelfPosture {
  if (!diagnostic.ok || !preflight.ok) {
    return "repair_needed";
  }
  if (diagnostic.summary.includes("warning") || diagnostic.metrics.recentFailureEvents > 0) {
    return "watch";
  }
  return "ready";
}

function stabilityScoreFor(diagnostic: SelfDiagnosticReport, preflight: SelfPreflightReport): number {
  const failCount = diagnostic.checks.filter((check) => check.level === "fail").length;
  const warnCount = diagnostic.checks.filter((check) => check.level === "warn").length;
  const failedPreflight = preflight.checks.filter((check) => !check.ok).length;
  const latencyPenalty =
    diagnostic.metrics.recentAssistantLatencyMs?.max &&
    diagnostic.metrics.recentAssistantLatencyMs.max > 8000
      ? 0.12
      : 0;
  const score =
    1 -
    failCount * 0.22 -
    warnCount * 0.08 -
    failedPreflight * 0.18 -
    diagnostic.metrics.recentFailureEvents * 0.05 -
    latencyPenalty;
  return Math.round(clamp01(score) * 1000) / 1000;
}

function risksFor(diagnostic: SelfDiagnosticReport, preflight: SelfPreflightReport): string[] {
  const risks: string[] = [];
  for (const check of diagnostic.checks) {
    if (check.level === "fail") {
      risks.push(`${check.name}: ${check.detail}`);
    }
  }
  for (const check of diagnostic.checks) {
    if (check.level === "warn") {
      risks.push(`${check.name}: ${check.detail}`);
    }
  }
  for (const check of preflight.checks) {
    if (!check.ok) {
      risks.push(`${check.name}: ${check.detail}`);
    }
  }
  return risks.slice(0, 12);
}

function nextActionsFor(
  diagnostic: SelfDiagnosticReport,
  preflight: SelfPreflightReport,
  repairPlan: SelfRepairPlan,
): string[] {
  if (diagnostic.ok && preflight.ok && repairPlan.summary === "ready") {
    return ["Continue self-monitoring and keep proactive loops quiet unless value is high."];
  }
  return repairPlan.items.map((item) => `${item.title}: ${item.reason}`).slice(0, 8);
}

export function buildSelfAwarenessReport(params: {
  diagnostic: SelfDiagnosticReport;
  preflight: SelfPreflightReport;
  repairPlan: SelfRepairPlan;
  now?: number;
}): SelfAwarenessReport {
  const posture = postureFor(params.diagnostic, params.preflight);
  const stabilityScore = stabilityScoreFor(params.diagnostic, params.preflight);
  const metrics = params.diagnostic.metrics;
  const risks = risksFor(params.diagnostic, params.preflight);
  const nextActions = nextActionsFor(params.diagnostic, params.preflight, params.repairPlan);

  return {
    generatedAt: params.now ?? Date.now(),
    identity: {
      name: "JARVIS-OS",
      role: "local proactive personal AI operating layer",
      operatingMode: "local_control_plane",
    },
    posture,
    summary:
      posture === "ready"
        ? "self layer is healthy and ready"
        : posture === "watch"
          ? "self layer is operational with watch items"
          : "self layer needs repair attention",
    stabilityScore,
    capabilities: [
      capability("models", params.diagnostic.ok, "chat and embedding keys plus routing are checked"),
      capability("memory", metrics.memoryRecords > 0, `${metrics.memoryRecords} durable memories`),
      capability("tools", metrics.toolCount >= 40, `${metrics.toolCount} registered tools`),
      capability("initiative", true, "proactive loop is covered by diagnostics"),
      capability("perception", metrics.perceptionTicks > 0, `${metrics.perceptionTicks} perception ticks`),
      capability("reflection", metrics.reflectionTicks > 0, `${metrics.reflectionTicks} reflection ticks`),
      capability("voice", metrics.voiceAvailable, "local Windows voice adapter"),
      capability("repair", params.preflight.ok, `${params.preflight.checks.length} preflight checks`),
    ],
    constraints: [
      "High-risk local actions still require explicit approval.",
      "Secrets stay outside committed project files.",
      "Self-repair is conservative: diagnose, plan, and only apply safe bounded actions.",
      "Movie-like agency is simulated through deterministic control loops, not consciousness.",
    ],
    risks,
    nextActions,
  };
}
