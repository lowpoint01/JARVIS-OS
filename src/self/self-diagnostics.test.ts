import { describe, expect, it } from "vitest";
import type { JarvisEvent } from "../shared/types.js";
import { diagnoseSelf } from "./self-diagnostics.js";

function baseInput() {
  return {
    uptimeMs: 1000,
    tickMs: 5000,
    activeLoop: {
      running: true,
      tickCount: 2,
      lastTickAt: 10_000,
      executedPlanCount: 0,
      handledPlanCount: 0,
    },
    perceptionTickMs: 10_000,
    perceptionLoop: {
      running: true,
      tickCount: 2,
      lastTickAt: 10_000,
    },
    memoryRecords: 3,
    conversationSessions: 1,
    pendingActions: 0,
    unreadNotifications: 0,
    scheduledReminders: 0,
    worldEntities: 1,
    worldRelations: 0,
    reflectionRecords: 1,
    reflectionTickMs: 15_000,
    reflectionLoop: {
      running: true,
      tickCount: 1,
      recordedCount: 1,
      lastTickAt: 10_000,
    },
    voiceStatus: {
      enabled: true,
      provider: "windows-sapi" as const,
      asrProvider: "faster-whisper" as const,
      asrModel: "large-v3-turbo",
      asrModelAvailable: true,
      fallbackToWindowsAsr: true,
      ttsProvider: "msedge-tts" as const,
      ttsVoice: "zh-CN-XiaoxiaoNeural",
      ttsModelAvailable: true,
      sapiAvailable: true,
      fallbackToSapi: true,
      language: "zh-CN",
      platform: "win32" as const,
      ttsAvailable: true,
      asrAvailable: true,
      available: true,
      rate: 0,
      volume: 80,
      maxChars: 1200,
      listenTimeoutMs: 7000,
    },
    toolNames: [
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
      "self.diagnose",
      "self.model",
      "self.preflight",
      "self.repair_plan",
    ],
    modelStatus: {
      chat: { hasKey: true },
      embedding: { hasKey: true },
    },
    recentEvents: [] as Array<JarvisEvent<unknown>>,
    now: 11_000,
  };
}

describe("diagnoseSelf", () => {
  it("reports healthy when required components are available", () => {
    const report = diagnoseSelf(baseInput());

    expect(report.ok).toBe(true);
    expect(report.summary).toBe("healthy");
  });

  it("fails when model keys or core tools are missing", () => {
    const input = baseInput();
    input.modelStatus = { chat: { hasKey: false }, embedding: { hasKey: true } };
    input.toolNames = input.toolNames.filter((tool) => tool !== "memory.recall");

    const report = diagnoseSelf(input);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "model.keys")?.level).toBe("fail");
    expect(report.checks.find((check) => check.name === "tool.registry")?.level).toBe("fail");
  });

  it("warns when recent failure events exist", () => {
    const input = baseInput();
    input.recentEvents = [
      {
        id: "event-1",
        type: "tool.call.failed",
        source: "test",
        timestamp: 11_000,
        importance: 0.7,
        payload: { error: "boom" },
      },
    ];

    const report = diagnoseSelf(input);

    expect(report.ok).toBe(true);
    expect(report.summary).toBe("healthy with warnings");
    expect(report.metrics.recentFailureEvents).toBe(1);
  });

  it("ignores synthetic full-check failure noise", () => {
    const input = baseInput();
    input.recentEvents = [
      {
        id: "event-1",
        type: "tool.call.failed",
        source: "test",
        timestamp: 11_000,
        importance: 0.7,
        payload: { error: "full check synthetic failure" },
      },
    ];

    const report = diagnoseSelf(input);

    expect(report.ok).toBe(true);
    expect(report.summary).toBe("healthy");
    expect(report.metrics.recentFailureEvents).toBe(0);
  });

  it("ignores expected tool boundary failures", () => {
    const input = baseInput();
    input.recentEvents = [
      {
        id: "event-1",
        type: "tool.call.failed",
        source: "tool-runtime",
        timestamp: 11_000,
        importance: 0.65,
        payload: {
          name: "files.read",
          error: "File is too large to read safely (5059 bytes > 5000).",
        },
      },
    ];

    const report = diagnoseSelf(input);

    expect(report.summary).toBe("healthy");
    expect(report.metrics.recentFailureEvents).toBe(0);
  });
});
