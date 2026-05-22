import type { SelfDiagnosticReport } from "../self/self-diagnostics.js";
import type { SelfAwarenessReport } from "../self/self-model.js";
import type { SelfPreflightReport } from "../self/self-repair.js";
import type { HealthSnapshot, JarvisConfig } from "../shared/types.js";
import type { VoiceStatus } from "../voice/windows-voice.js";

export type EnterpriseReadinessLevel = "pass" | "watch" | "fail";

export type EnterpriseReadinessCheck = {
  name: string;
  level: EnterpriseReadinessLevel;
  category:
    | "service"
    | "security"
    | "data"
    | "observability"
    | "intelligence"
    | "automation"
    | "operations";
  detail: string;
  recommendation?: string;
};

export type EnterpriseReadinessReport = {
  ok: boolean;
  generatedAt: number;
  maturity: "enterprise-ready" | "enterprise-watch" | "not-ready";
  score: number;
  summary: string;
  checks: EnterpriseReadinessCheck[];
  nextActions: string[];
};

export type EnterpriseReadinessInput = {
  health: HealthSnapshot;
  self: SelfDiagnosticReport;
  selfModel: SelfAwarenessReport;
  preflight: SelfPreflightReport;
  runtime: JarvisConfig["runtime"];
  storage: JarvisConfig["storage"];
  safety: JarvisConfig["safety"];
  modelStatus: Record<string, unknown>;
  voiceStatus: VoiceStatus;
  toolNames: string[];
};

const REQUIRED_ENTERPRISE_TOOLS = [
  "system.health",
  "events.recent",
  "model.status",
  "model.probe",
  "model.chat",
  "embedding.embed",
  "memory.store",
  "memory.recall",
  "memory.recent",
  "memory.extract",
  "memory.vault_status",
  "initiative.decide",
  "initiative.status",
  "initiative.tick",
  "perception.status",
  "reflection.record",
  "reflection.list",
  "reflection.find",
  "self.diagnose",
  "self.model",
  "self.preflight",
  "self.repair_plan",
  "briefing.generate",
  "actions.propose",
  "actions.pending",
  "actions.list",
  "notifications.create",
  "notifications.unread",
  "notifications.list",
  "notifications.read",
  "notifications.dismiss",
  "reminders.create",
  "reminders.list",
  "reminders.cancel",
  "files.search",
  "files.read",
  "files.backup",
  "desktop.open",
  "powershell.run",
  "world.upsert_entity",
  "world.find",
  "world.link",
  "world.snapshot",
  "voice.status",
  "voice.devices",
  "voice.transcribe_audio",
  "voice.speak",
  "voice.tts_probe",
  "voice.listen_once",
  "maintenance.status",
  "maintenance.prune_full_check",
] as const;

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  return recordFrom(recordFrom(value)?.[key]);
}

function nestedBool(value: unknown, key: string): boolean {
  const record = recordFrom(value);
  return typeof record?.[key] === "boolean" ? record[key] : false;
}

function componentOk(health: HealthSnapshot, name: string): boolean {
  return Boolean(health.components[name]?.ok);
}

function addCheck(checks: EnterpriseReadinessCheck[], check: EnterpriseReadinessCheck): void {
  checks.push(check);
}

function storagePathsConfigured(storage: JarvisConfig["storage"]): boolean {
  return Object.values(storage).every((value) => typeof value === "string" && value.startsWith("data/"));
}

function safetyPolicyIsEnterpriseConservative(safety: JarvisConfig["safety"]): boolean {
  return (
    safety.autoAllowLevels.includes("L0") &&
    safety.autoAllowLevels.includes("L1") &&
    safety.confirmLevels.includes("L2") &&
    safety.confirmLevels.includes("L3") &&
    safety.blockLevels.includes("L4")
  );
}

function readinessScore(checks: EnterpriseReadinessCheck[]): number {
  const penalty = checks.reduce((total, check) => {
    if (check.level === "fail") {
      return total + 14;
    }
    if (check.level === "watch") {
      return total + 4;
    }
    return total;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function nextActionsFor(checks: EnterpriseReadinessCheck[]): string[] {
  const actionable = checks
    .filter((check) => check.level !== "pass")
    .map((check) => check.recommendation ?? `${check.name}: ${check.detail}`);
  return actionable.length > 0
    ? actionable.slice(0, 8)
    : [
        "重大变更前保持 pnpm check:enterprise 通过。",
        "定期检查未读通知和运行审计报告。",
      ];
}

export function buildEnterpriseReadinessReport(
  input: EnterpriseReadinessInput,
  now = Date.now(),
): EnterpriseReadinessReport {
  const checks: EnterpriseReadinessCheck[] = [];
  const chatStatus = nestedRecord(input.modelStatus, "chat");
  const embeddingStatus = nestedRecord(input.modelStatus, "embedding");
  const routing = nestedRecord(input.modelStatus, "routing");
  const chatLatency = nestedRecord(routing, "chatLatency");
  const embeddingLatency = nestedRecord(routing, "embeddingLatency");
  const missingTools = REQUIRED_ENTERPRISE_TOOLS.filter((tool) => !input.toolNames.includes(tool));

  addCheck(checks, {
    name: "service.health",
    category: "service",
    level: input.health.ok && input.health.ready ? "pass" : "fail",
    detail: `ok=${input.health.ok}; ready=${input.health.ready}; uptimeMs=${input.health.uptimeMs}`,
    recommendation: "Restart the gateway and inspect gateway.err.log.",
  });

  addCheck(checks, {
    name: "service.local_binding",
    category: "security",
    level: input.runtime.host === "127.0.0.1" ? "pass" : "watch",
    detail: `host=${input.runtime.host}; port=${input.runtime.port}`,
    recommendation: "Keep enterprise-local deployments bound to 127.0.0.1 unless a network access policy exists.",
  });

  addCheck(checks, {
    name: "self.posture",
    category: "operations",
    level: input.self.ok && input.selfModel.posture === "ready" ? "pass" : input.self.ok ? "watch" : "fail",
    detail: `summary=${input.self.summary}; posture=${input.selfModel.posture}; stability=${input.selfModel.stabilityScore}`,
    recommendation: "Run self.diagnose and self.repair_plan, then fix failed checks before promotion.",
  });

  addCheck(checks, {
    name: "preflight",
    category: "operations",
    level: input.preflight.ok ? "pass" : "fail",
    detail: `${input.preflight.checks.filter((check) => check.ok).length}/${input.preflight.checks.length} checks passing`,
    recommendation: "Repair failed preflight checks before deployment.",
  });

  addCheck(checks, {
    name: "models.chat",
    category: "intelligence",
    level: nestedBool(chatStatus, "hasKey") ? "pass" : "fail",
    detail: `provider=${String(chatStatus?.provider ?? "unknown")}; model=${String(chatStatus?.model ?? "unknown")}; hasKey=${nestedBool(chatStatus, "hasKey")}`,
    recommendation: "Configure the chat model key through environment variables or the ignored local secrets file.",
  });

  addCheck(checks, {
    name: "models.embedding",
    category: "intelligence",
    level: nestedBool(embeddingStatus, "hasKey") ? "pass" : "fail",
    detail: `provider=${String(embeddingStatus?.provider ?? "unknown")}; model=${String(embeddingStatus?.model ?? "unknown")}; hasKey=${nestedBool(embeddingStatus, "hasKey")}`,
    recommendation: "Configure the embedding model key so memory recall and dedupe stay available.",
  });

  const maxChatLatency =
    typeof chatLatency?.maxMs === "number" ? (chatLatency.maxMs as number) : undefined;
  addCheck(checks, {
    name: "models.latency",
    category: "intelligence",
    level: maxChatLatency === undefined || maxChatLatency <= 8000 ? "pass" : "watch",
    detail: `chatMaxMs=${maxChatLatency ?? "none"}; embeddingLastMs=${String(embeddingLatency?.lastMs ?? "none")}`,
    recommendation: "Keep default fast mode enabled and investigate slow upstream calls.",
  });

  addCheck(checks, {
    name: "tool.registry",
    category: "automation",
    level: missingTools.length === 0 ? "pass" : "fail",
    detail: `${input.toolNames.length} registered; missing=${missingTools.join(", ") || "none"}`,
    recommendation: "Restore missing tool registrations before enterprise use.",
  });

  addCheck(checks, {
    name: "safety.policy",
    category: "security",
    level: safetyPolicyIsEnterpriseConservative(input.safety) ? "pass" : "fail",
    detail: `auto=${input.safety.autoAllowLevels.join(",")}; confirm=${input.safety.confirmLevels.join(",")}; block=${input.safety.blockLevels.join(",")}`,
    recommendation: "Use L0/L1 auto-allow, L2/L3 confirmation, and L4 blocking.",
  });

  addCheck(checks, {
    name: "data.storage",
    category: "data",
    level: storagePathsConfigured(input.storage) ? "pass" : "watch",
    detail: Object.values(input.storage).join("; "),
    recommendation: "Keep runtime data under data/ so backups and cleanup policies can be bounded.",
  });

  addCheck(checks, {
    name: "data.memory",
    category: "data",
    level: input.self.metrics.memoryRecords > 0 ? "pass" : "watch",
    detail: `${input.self.metrics.memoryRecords} memories`,
    recommendation: "Seed durable memory and verify memory.recall before production usage.",
  });

  addCheck(checks, {
    name: "observability.events",
    category: "observability",
    level: componentOk(input.health, "events") && input.self.metrics.recentFailureEvents === 0 ? "pass" : "watch",
    detail: `events=${input.health.components.events?.detail ?? "unknown"}; recentFailures=${input.self.metrics.recentFailureEvents}`,
    recommendation: "Inspect /events/recent and resolve repeated failures.",
  });

  addCheck(checks, {
    name: "loops.runtime",
    category: "automation",
    level:
      componentOk(input.health, "initiative") &&
      componentOk(input.health, "perception") &&
      componentOk(input.health, "reflection")
        ? "pass"
        : "fail",
    detail: `initiative=${componentOk(input.health, "initiative")}; perception=${componentOk(input.health, "perception")}; reflection=${componentOk(input.health, "reflection")}`,
    recommendation: "Restart the gateway and inspect loop failure events.",
  });

  addCheck(checks, {
    name: "voice.local",
    category: "operations",
    level: input.voiceStatus.available ? "pass" : "watch",
    detail: `provider=${input.voiceStatus.provider}; asrProvider=${input.voiceStatus.asrProvider}; asrModel=${input.voiceStatus.asrModel}; ttsProvider=${input.voiceStatus.ttsProvider}; voice=${input.voiceStatus.ttsVoice}; language=${input.voiceStatus.language}; tts=${input.voiceStatus.ttsAvailable}; asr=${input.voiceStatus.asrAvailable}`,
    recommendation: "Install or enable Windows zh-CN SAPI voice services if voice operation is required.",
  });

  addCheck(checks, {
    name: "operations.queues",
    category: "operations",
    level:
      input.self.metrics.pendingActions === 0 && input.self.metrics.scheduledReminders < 100
        ? "pass"
        : "watch",
    detail: `pendingActions=${input.self.metrics.pendingActions}; scheduledReminders=${input.self.metrics.scheduledReminders}; unreadNotifications=${input.self.metrics.unreadNotifications}`,
    recommendation: "Review pending actions, reminders, and unread notifications before handoff.",
  });

  const reportChecks = checks.map((check) =>
    check.level === "pass" ? { ...check, recommendation: undefined } : check,
  );
  const score = readinessScore(reportChecks);
  const hasFail = reportChecks.some((check) => check.level === "fail");
  const hasWatch = reportChecks.some((check) => check.level === "watch");
  const maturity = hasFail ? "not-ready" : hasWatch ? "enterprise-watch" : "enterprise-ready";

  return {
    ok: !hasFail,
    generatedAt: now,
    maturity,
    score,
    summary:
      maturity === "enterprise-ready"
        ? "企业就绪门禁全部通过"
        : maturity === "enterprise-watch"
          ? "企业就绪可用，但存在观察项"
          : "企业就绪被失败门禁阻断",
    checks: reportChecks,
    nextActions: nextActionsFor(reportChecks),
  };
}
