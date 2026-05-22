import type { ActiveLoopStatus } from "../initiative/active-loop.js";
import type { PerceptionLoopStatus } from "../perception/perception-loop.js";
import type { ReflectionLoopStatus } from "../reflection/reflection-loop.js";
import type { JarvisEvent } from "../shared/types.js";
import type { VoiceStatus } from "../voice/windows-voice.js";

export type DiagnosticLevel = "ok" | "warn" | "fail";

export type DiagnosticCheck = {
  name: string;
  level: DiagnosticLevel;
  detail: string;
  recommendation?: string;
};

export type SelfDiagnosticReport = {
  ok: boolean;
  generatedAt: number;
  summary: string;
  checks: DiagnosticCheck[];
  metrics: {
    uptimeMs: number;
    memoryRecords: number;
    conversationSessions: number;
    pendingActions: number;
    unreadNotifications: number;
    scheduledReminders: number;
    worldEntities: number;
    worldRelations: number;
    reflectionRecords: number;
    reflectionTicks: number;
    voiceAvailable: boolean;
    toolCount: number;
    perceptionTicks: number;
    recentFailureEvents: number;
    recentAssistantLatencyMs?: {
      count: number;
      average: number;
      max: number;
    };
  };
};

export type DiagnoseSelfInput = {
  uptimeMs: number;
  tickMs: number;
  activeLoop: ActiveLoopStatus;
  perceptionTickMs: number;
  perceptionLoop: PerceptionLoopStatus;
  memoryRecords: number;
  conversationSessions: number;
  pendingActions: number;
  unreadNotifications: number;
  scheduledReminders: number;
  worldEntities: number;
  worldRelations: number;
  reflectionRecords: number;
  reflectionTickMs: number;
  reflectionLoop: ReflectionLoopStatus;
  voiceStatus: VoiceStatus;
  toolNames: string[];
  modelStatus: Record<string, unknown>;
  recentEvents: Array<JarvisEvent<unknown>>;
  now?: number;
};

const REQUIRED_TOOLS = [
  "system.health",
  "model.status",
  "model.probe",
  "model.chat",
  "embedding.embed",
  "initiative.decide",
  "initiative.status",
  "initiative.tick",
  "memory.store",
  "memory.recall",
  "memory.extract",
  "memory.vault_status",
  "actions.propose",
  "actions.pending",
  "actions.list",
  "notifications.unread",
  "notifications.list",
  "notifications.read",
  "notifications.dismiss",
  "notifications.create",
  "reminders.create",
  "reminders.list",
  "reminders.cancel",
  "perception.status",
  "files.search",
  "files.read",
  "files.backup",
  "desktop.open",
  "powershell.run",
  "world.upsert_entity",
  "world.find",
  "world.link",
  "world.snapshot",
  "reflection.record",
  "reflection.list",
  "reflection.find",
  "voice.status",
  "voice.devices",
  "voice.transcribe_audio",
  "voice.speak",
  "voice.tts_probe",
  "voice.listen_once",
  "maintenance.status",
  "maintenance.prune_full_check",
  "briefing.generate",
  "self.diagnose",
  "self.model",
  "self.preflight",
  "self.repair_plan",
];

function nestedBool(value: unknown, key: string): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      key in value &&
      typeof (value as Record<string, unknown>)[key] === "boolean" &&
      (value as Record<string, unknown>)[key],
  );
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || !(key in value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : undefined;
}

function eventHasFailure(event: JarvisEvent<unknown>): boolean {
  if (isSyntheticFullCheckEvent(event)) {
    return false;
  }
  if (isExpectedBoundaryFailure(event)) {
    return false;
  }
  if (event.type.includes("failed") || event.type.includes("error")) {
    return true;
  }
  const payload = event.payload;
  return Boolean(payload && typeof payload === "object" && "error" in payload);
}

function eventText(event: JarvisEvent<unknown>): string {
  const payload = event.payload;
  const payloadText =
    payload && typeof payload === "object"
      ? Object.values(payload)
          .filter((value) => typeof value === "string" || typeof value === "number")
          .map(String)
          .join(" ")
      : "";
  return `${event.type} ${event.source} ${payloadText}`.toLowerCase();
}

function isSyntheticFullCheckEvent(event: JarvisEvent<unknown>): boolean {
  const text = eventText(event);
  return text.includes("full check") || text.includes("full-check");
}

function isExpectedBoundaryFailure(event: JarvisEvent<unknown>): boolean {
  if (event.type !== "tool.call.failed") {
    return false;
  }
  const text = eventText(event);
  return [
    "too large to read safely",
    "requires {",
    "requires non-empty",
    "outside configured",
    "inside an excluded segment",
    "refusing to read",
    "not pending",
    "not found",
  ].some((pattern) => text.includes(pattern));
}

function assistantLatency(event: JarvisEvent<unknown>): number | undefined {
  if (event.type !== "chat.assistant_message") {
    return undefined;
  }
  const payload = event.payload;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>).latencyMs;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeLatency(values: number[]): SelfDiagnosticReport["metrics"]["recentAssistantLatencyMs"] {
  if (values.length === 0) {
    return undefined;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    average: Math.round(total / values.length),
    max: Math.max(...values),
  };
}

function addCheck(checks: DiagnosticCheck[], check: DiagnosticCheck): void {
  checks.push(check);
}

export function diagnoseSelf(input: DiagnoseSelfInput): SelfDiagnosticReport {
  const now = input.now ?? Date.now();
  const checks: DiagnosticCheck[] = [];
  const chatStatus = nestedRecord(input.modelStatus, "chat");
  const embeddingStatus = nestedRecord(input.modelStatus, "embedding");
  const chatHasKey = nestedBool(chatStatus, "hasKey");
  const embeddingHasKey = nestedBool(embeddingStatus, "hasKey");
  const missingTools = REQUIRED_TOOLS.filter((tool) => !input.toolNames.includes(tool));
  const recentFailureEvents = input.recentEvents.filter(eventHasFailure).length;
  const latencyValues = input.recentEvents
    .map(assistantLatency)
    .filter((value): value is number => typeof value === "number");
  const latency = summarizeLatency(latencyValues);

  addCheck(checks, {
    name: "model.keys",
    level: chatHasKey && embeddingHasKey ? "ok" : "fail",
    detail: `chatKey=${chatHasKey}; embeddingKey=${embeddingHasKey}`,
    recommendation:
      chatHasKey && embeddingHasKey
        ? undefined
        : "Set JARVIS_MOONSHOT_API_KEY / JARVIS_VOLCENGINE_API_KEY or configs/secrets.local.yaml.",
  });

  const tickAge = input.activeLoop.lastTickAt ? now - input.activeLoop.lastTickAt : undefined;
  const staleTick = tickAge === undefined || tickAge > input.tickMs * 3 + 2000;
  addCheck(checks, {
    name: "initiative.loop",
    level: input.activeLoop.running && !staleTick ? "ok" : "fail",
    detail: `running=${input.activeLoop.running}; tickCount=${input.activeLoop.tickCount}; lastTickAgeMs=${tickAge ?? "none"}`,
    recommendation:
      input.activeLoop.running && !staleTick
        ? undefined
        : "Restart the gateway or inspect initiative.tick_failed events.",
  });

  const perceptionTickAge = input.perceptionLoop.lastTickAt
    ? now - input.perceptionLoop.lastTickAt
    : undefined;
  const stalePerceptionTick =
    perceptionTickAge === undefined || perceptionTickAge > input.perceptionTickMs * 3 + 2000;
  addCheck(checks, {
    name: "perception.loop",
    level: input.perceptionLoop.running && !stalePerceptionTick ? "ok" : "fail",
    detail: `running=${input.perceptionLoop.running}; tickCount=${input.perceptionLoop.tickCount}; lastTickAgeMs=${perceptionTickAge ?? "none"}`,
    recommendation:
      input.perceptionLoop.running && !stalePerceptionTick
        ? undefined
        : "Restart the gateway or inspect perception.tick_failed events.",
  });

  addCheck(checks, {
    name: "memory.store",
    level: input.memoryRecords > 0 ? "ok" : "warn",
    detail: `${input.memoryRecords} long-term records`,
    recommendation:
      input.memoryRecords > 0
        ? undefined
        : "Start a conversation or call memory.store to seed durable memory.",
  });

  addCheck(checks, {
    name: "conversation.store",
    level: input.conversationSessions > 0 ? "ok" : "warn",
    detail: `${input.conversationSessions} sessions`,
    recommendation:
      input.conversationSessions > 0
        ? undefined
        : "No persisted sessions yet; this is normal for a fresh install.",
  });

  addCheck(checks, {
    name: "action.queue",
    level: input.pendingActions > 20 ? "warn" : "ok",
    detail: `${input.pendingActions} pending actions`,
    recommendation:
      input.pendingActions > 20
        ? "Review /actions/pending and approve or reject stale actions."
        : undefined,
  });

  addCheck(checks, {
    name: "notifications",
    level: input.unreadNotifications > 50 ? "warn" : "ok",
    detail: `${input.unreadNotifications} unread notifications`,
    recommendation:
      input.unreadNotifications > 50
        ? "Review /notifications/unread and dismiss stale notifications."
        : undefined,
  });

  addCheck(checks, {
    name: "reminders",
    level: "ok",
    detail: `${input.scheduledReminders} scheduled reminders`,
  });

  addCheck(checks, {
    name: "world.model",
    level: input.worldEntities > 0 ? "ok" : "warn",
    detail: `${input.worldEntities} entities, ${input.worldRelations} relations`,
    recommendation:
      input.worldEntities > 0
        ? undefined
        : "Seed project/device/service entities so JARVIS can reason about its environment.",
  });

  const reflectionTickAge = input.reflectionLoop.lastTickAt
    ? now - input.reflectionLoop.lastTickAt
    : undefined;
  const staleReflectionTick =
    reflectionTickAge === undefined || reflectionTickAge > input.reflectionTickMs * 3 + 2000;
  addCheck(checks, {
    name: "reflection.loop",
    level: input.reflectionLoop.running && !staleReflectionTick ? "ok" : "fail",
    detail: `running=${input.reflectionLoop.running}; tickCount=${input.reflectionLoop.tickCount}; records=${input.reflectionRecords}; lastTickAgeMs=${reflectionTickAge ?? "none"}`,
    recommendation:
      input.reflectionLoop.running && !staleReflectionTick
        ? undefined
        : "Restart the gateway or inspect reflection.tick_failed events.",
  });

  addCheck(checks, {
    name: "voice.output",
    level: input.voiceStatus.ttsAvailable ? "ok" : "warn",
    detail: `enabled=${input.voiceStatus.enabled}; provider=${input.voiceStatus.provider}; asrProvider=${input.voiceStatus.asrProvider}; asrModel=${input.voiceStatus.asrModel}; platform=${input.voiceStatus.platform}; tts=${input.voiceStatus.ttsAvailable}; asr=${input.voiceStatus.asrAvailable}`,
    recommendation: input.voiceStatus.ttsAvailable
      ? undefined
      : "Voice output requires Windows with System.Speech available.",
  });

  addCheck(checks, {
    name: "tool.registry",
    level: missingTools.length === 0 ? "ok" : "fail",
    detail: `${input.toolNames.length} tools registered`,
    recommendation:
      missingTools.length === 0 ? undefined : `Missing required tools: ${missingTools.join(", ")}`,
  });

  addCheck(checks, {
    name: "recent.failures",
    level: recentFailureEvents === 0 ? "ok" : recentFailureEvents > 5 ? "fail" : "warn",
    detail: `${recentFailureEvents} failure-like events in recent history`,
    recommendation:
      recentFailureEvents === 0
        ? undefined
        : "Inspect /events/recent and fix repeated upstream, memory, or tool failures.",
  });

  if (latency) {
    addCheck(checks, {
      name: "chat.latency",
      level: latency.max > 8000 ? "warn" : "ok",
      detail: `assistant latency avg=${latency.average}ms max=${latency.max}ms count=${latency.count}`,
      recommendation:
        latency.max > 8000
          ? "Use thinking=disabled for routine chat and reserve deep thinking for explicit complex tasks."
          : undefined,
    });
  }

  const hasFail = checks.some((check) => check.level === "fail");
  const hasWarn = checks.some((check) => check.level === "warn");
  return {
    ok: !hasFail,
    generatedAt: now,
    summary: hasFail ? "self-check failed" : hasWarn ? "healthy with warnings" : "healthy",
    checks,
    metrics: {
      uptimeMs: input.uptimeMs,
      memoryRecords: input.memoryRecords,
      conversationSessions: input.conversationSessions,
      pendingActions: input.pendingActions,
      unreadNotifications: input.unreadNotifications,
      scheduledReminders: input.scheduledReminders,
      worldEntities: input.worldEntities,
      worldRelations: input.worldRelations,
      reflectionRecords: input.reflectionRecords,
      reflectionTicks: input.reflectionLoop.tickCount,
      voiceAvailable: input.voiceStatus.available,
      toolCount: input.toolNames.length,
      perceptionTicks: input.perceptionLoop.tickCount,
      recentFailureEvents,
      recentAssistantLatencyMs: latency,
    },
  };
}
