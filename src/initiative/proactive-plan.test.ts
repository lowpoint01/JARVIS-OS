import { describe, expect, it } from "vitest";
import type { JarvisEvent } from "../shared/types.js";
import { actionableInitiativeEvents, createProactivePlan } from "./proactive-plan.js";

function event(type: string, payload: Record<string, unknown> = {}): JarvisEvent {
  return {
    id: `evt-${type}`,
    type,
    source: "test",
    timestamp: Date.now(),
    importance: 0.8,
    payload,
  };
}

describe("actionableInitiativeEvents", () => {
  it("filters internal loop noise and full-check artifacts", () => {
    const events = [
      event("initiative.tick"),
      event("tool.call.completed"),
      event("action.rejected", { reason: "full check cleanup" }),
      event("tool.call.failed", { error: "real failure" }),
    ];

    expect(actionableInitiativeEvents(events).map((item) => item.type)).toEqual(["tool.call.failed"]);
  });

  it("filters expected tool boundary failures", () => {
    const events = [
      event("tool.call.failed", {
        name: "files.read",
        error: "File is too large to read safely (5059 bytes > 5000).",
      }),
    ];

    expect(actionableInitiativeEvents(events)).toEqual([]);
  });
});

describe("createProactivePlan", () => {
  it("turns tool failures into proactive notifications", () => {
    const plan = createProactivePlan([event("tool.call.failed", { error: "boom" })], {
      score: 0.6,
      level: "A3_PROACTIVE_NOTIFY",
      reason: "useful enough to notify",
    });

    expect(plan.kind).toBe("notify");
    expect(plan.notification?.title).toBe("Runtime attention needed");
  });

  it("does not duplicate event-owned notifications", () => {
    const plan = createProactivePlan([event("reminder.due", { title: "Stretch" })], {
      score: 0.7,
      level: "A3_PROACTIVE_NOTIFY",
      reason: "useful enough to notify",
    });

    expect(plan.kind).toBe("prepare");
    expect(plan.notification).toBeUndefined();
  });
});
