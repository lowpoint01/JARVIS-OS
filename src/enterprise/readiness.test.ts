import { describe, expect, it } from "vitest";
import { buildEnterpriseReadinessReport, type EnterpriseReadinessInput } from "./readiness.js";

const toolNames = [
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
  "enterprise.readiness",
];

function healthyInput(): EnterpriseReadinessInput {
  return {
    health: {
      ok: true,
      ready: true,
      uptimeMs: 1000,
      version: "0.1.0",
      components: {
        events: { ok: true, detail: "data/events/events.jsonl" },
        initiative: { ok: true },
        perception: { ok: true },
        reflection: { ok: true },
      },
    },
    self: {
      ok: true,
      generatedAt: 1,
      summary: "healthy",
      checks: [],
      metrics: {
        uptimeMs: 1000,
        memoryRecords: 3,
        conversationSessions: 1,
        pendingActions: 0,
        unreadNotifications: 0,
        scheduledReminders: 0,
        worldEntities: 1,
        worldRelations: 0,
        reflectionRecords: 1,
        reflectionTicks: 1,
        voiceAvailable: true,
        toolCount: toolNames.length,
        perceptionTicks: 1,
        recentFailureEvents: 0,
      },
    },
    selfModel: {
      generatedAt: 1,
      identity: {
        name: "JARVIS-OS",
        role: "local proactive personal AI operating layer",
        operatingMode: "local_control_plane",
      },
      posture: "ready",
      summary: "ready",
      stabilityScore: 0.98,
      capabilities: [],
      constraints: [],
      risks: [],
      nextActions: [],
    },
    preflight: {
      ok: true,
      generatedAt: 1,
      checks: [{ name: "self.diagnose", ok: true, detail: "healthy" }],
    },
    runtime: {
      name: "JARVIS-OS",
      host: "127.0.0.1",
      port: 31888,
    },
    storage: {
      eventLogPath: "data/events/events.jsonl",
      auditLogPath: "data/audit/audit.jsonl",
      memoryLogPath: "data/memory/memories.jsonl",
      memoryVaultDir: "data/memory-vault",
      conversationDir: "data/conversations",
      actionLogPath: "data/actions/actions.jsonl",
      notificationLogPath: "data/notifications/notifications.jsonl",
      reminderLogPath: "data/reminders/reminders.jsonl",
      worldModelPath: "data/world/world.json",
      reflectionLogPath: "data/reflection/reflections.jsonl",
    },
    safety: {
      autoAllowLevels: ["L0", "L1"],
      confirmLevels: ["L2", "L3"],
      blockLevels: ["L4"],
    },
    modelStatus: {
      chat: {
        provider: "moonshot",
        model: "kimi-k2.6",
        hasKey: true,
      },
      embedding: {
        provider: "volcengine",
        model: "doubao-embedding-vision-251215",
        hasKey: true,
      },
      routing: {
        defaultMode: "fast",
        chatLatency: { count: 1, maxMs: 3000 },
        embeddingLatency: { count: 1, lastMs: 400 },
      },
    },
    voiceStatus: {
      enabled: true,
      provider: "windows-sapi",
      asrProvider: "faster-whisper",
      asrModel: "large-v3-turbo",
      asrModelAvailable: true,
      fallbackToWindowsAsr: true,
      ttsProvider: "msedge-tts",
      ttsVoice: "zh-CN-XiaoxiaoNeural",
      ttsModelAvailable: true,
      sapiAvailable: true,
      fallbackToSapi: true,
      language: "zh-CN",
      platform: "win32",
      ttsAvailable: true,
      asrAvailable: true,
      available: true,
      rate: 0,
      volume: 85,
      maxChars: 500,
      listenTimeoutMs: 7000,
    },
    toolNames,
  };
}

describe("buildEnterpriseReadinessReport", () => {
  it("passes when service, models, tools, storage, safety, and loops are healthy", () => {
    const report = buildEnterpriseReadinessReport(healthyInput(), 123);

    expect(report.ok).toBe(true);
    expect(report.generatedAt).toBe(123);
    expect(report.maturity).toBe("enterprise-ready");
    expect(report.score).toBe(100);
    expect(report.checks.every((check) => check.level === "pass")).toBe(true);
    expect(report.summary).toBe("企业就绪门禁全部通过");
    expect(report.checks.every((check) => check.recommendation === undefined)).toBe(true);
    expect(report.nextActions.join("\n")).toContain("pnpm check:enterprise");
  });

  it("blocks enterprise readiness when model keys and required tools are missing", () => {
    const input = healthyInput();
    input.modelStatus = {
      ...input.modelStatus,
      chat: { provider: "moonshot", model: "kimi-k2.6", hasKey: false },
    };
    input.toolNames = input.toolNames.filter((name) => name !== "memory.recall");

    const report = buildEnterpriseReadinessReport(input);

    expect(report.ok).toBe(false);
    expect(report.maturity).toBe("not-ready");
    expect(report.checks.find((check) => check.name === "models.chat")?.level).toBe("fail");
    expect(report.checks.find((check) => check.name === "tool.registry")?.level).toBe("fail");
  });

  it("keeps usable deployments in watch mode for latency and local voice degradation", () => {
    const input = healthyInput();
    input.modelStatus = {
      ...input.modelStatus,
      routing: {
        defaultMode: "fast",
        chatLatency: { count: 1, maxMs: 9000 },
        embeddingLatency: { count: 1, lastMs: 400 },
      },
    };
    input.voiceStatus = {
      ...input.voiceStatus,
      ttsAvailable: false,
      asrAvailable: false,
      available: false,
    };

    const report = buildEnterpriseReadinessReport(input);

    expect(report.ok).toBe(true);
    expect(report.maturity).toBe("enterprise-watch");
    expect(report.checks.find((check) => check.name === "models.latency")?.level).toBe("watch");
    expect(report.checks.find((check) => check.name === "voice.local")?.level).toBe("watch");
  });
});
