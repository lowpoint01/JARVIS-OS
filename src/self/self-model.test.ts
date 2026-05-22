import { describe, expect, it } from "vitest";
import type { SelfDiagnosticReport } from "./self-diagnostics.js";
import { buildSelfAwarenessReport } from "./self-model.js";

function diagnostic(overrides: Partial<SelfDiagnosticReport> = {}): SelfDiagnosticReport {
  return {
    ok: true,
    generatedAt: 1,
    summary: "healthy",
    checks: [{ name: "model.keys", level: "ok", detail: "ready" }],
    metrics: {
      uptimeMs: 1000,
      memoryRecords: 8,
      conversationSessions: 1,
      pendingActions: 0,
      unreadNotifications: 0,
      scheduledReminders: 0,
      worldEntities: 1,
      worldRelations: 0,
      reflectionRecords: 0,
      reflectionTicks: 1,
      voiceAvailable: true,
      toolCount: 49,
      perceptionTicks: 1,
      recentFailureEvents: 0,
    },
    ...overrides,
  };
}

describe("buildSelfAwarenessReport", () => {
  it("reports ready posture for healthy diagnostics and preflight", () => {
    const report = buildSelfAwarenessReport({
      diagnostic: diagnostic(),
      preflight: {
        ok: true,
        generatedAt: 1,
        checks: [{ name: "data.write", ok: true, detail: "writable" }],
      },
      repairPlan: {
        ok: true,
        generatedAt: 1,
        summary: "ready",
        items: [{ title: "No repair needed", riskLevel: "L0", reason: "All passed." }],
      },
      now: 123,
    });

    expect(report.posture).toBe("ready");
    expect(report.stabilityScore).toBe(1);
    expect(report.capabilities.some((item) => item.name === "memory")).toBe(true);
  });

  it("drops into repair posture when diagnostics fail", () => {
    const report = buildSelfAwarenessReport({
      diagnostic: diagnostic({
        ok: false,
        summary: "self-check failed",
        checks: [{ name: "tool.registry", level: "fail", detail: "missing tool" }],
      }),
      preflight: {
        ok: true,
        generatedAt: 1,
        checks: [{ name: "data.write", ok: true, detail: "writable" }],
      },
      repairPlan: {
        ok: false,
        generatedAt: 1,
        summary: "repair actions suggested",
        items: [{ title: "Inspect failed self-diagnostic checks", riskLevel: "L0", reason: "missing tool" }],
      },
    });

    expect(report.posture).toBe("repair_needed");
    expect(report.stabilityScore).toBeLessThan(1);
    expect(report.risks.join("\n")).toContain("tool.registry");
  });
});
