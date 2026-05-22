import { describe, expect, it } from "vitest";
import { briefingToPrompt, generateBriefing } from "./briefing.js";

describe("generateBriefing", () => {
  it("marks healthy idle state as ok", () => {
    const report = generateBriefing({
      now: 123,
      selfSummary: "healthy",
      selfOk: true,
      toolCount: 46,
      memoryRecords: 8,
      worldEntities: 1,
      reflectionRecords: 0,
      unreadNotifications: 0,
      pendingActions: 0,
      scheduledReminders: 0,
      modelDefaultMode: "fast",
      chatLatencyLastMs: 700,
      voiceAvailable: true,
      perceptionRunning: true,
      recentFailures: 0,
    });

    expect(report.severity).toBe("ok");
    expect(report.headline).toContain("准备好");
    expect(report.suggestedActions).toEqual(["继续保持正常主动监控。"]);
  });

  it("escalates pending approvals and failure signals", () => {
    const report = generateBriefing({
      selfSummary: "healthy",
      selfOk: true,
      toolCount: 46,
      memoryRecords: 8,
      worldEntities: 1,
      reflectionRecords: 2,
      unreadNotifications: 3,
      pendingActions: 1,
      scheduledReminders: 2,
      modelDefaultMode: "fast",
      chatLatencyLastMs: 2500,
      voiceAvailable: false,
      perceptionRunning: true,
      recentFailures: 1,
    });

    expect(report.severity).toBe("action");
    expect(report.suggestedActions.join("\n")).toContain("待审批动作");
    expect(report.suggestedActions.join("\n")).toContain("最近事件");
  });
});

describe("briefingToPrompt", () => {
  it("serializes the active state into concise prompt context", () => {
    const report = generateBriefing({
      now: 123,
      selfSummary: "healthy",
      selfOk: true,
      toolCount: 46,
      memoryRecords: 8,
      worldEntities: 1,
      reflectionRecords: 0,
      unreadNotifications: 0,
      pendingActions: 0,
      scheduledReminders: 0,
      modelDefaultMode: "fast",
      voiceAvailable: true,
      perceptionRunning: true,
      recentFailures: 0,
    });

    expect(briefingToPrompt(report)).toContain("当前 JARVIS 简报");
    expect(briefingToPrompt(report)).toContain("工具：已注册 46 个");
  });
});
