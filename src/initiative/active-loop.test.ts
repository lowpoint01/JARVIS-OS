import { describe, expect, it } from "vitest";
import type { JarvisEvent } from "../shared/types.js";
import { buildInitiativeSignal } from "./active-loop.js";

function event(type: string, importance: number): JarvisEvent {
  return {
    id: `event-${type}`,
    type,
    source: "test",
    timestamp: Date.now(),
    importance,
    payload: {},
  };
}

describe("buildInitiativeSignal", () => {
  it("raises urgency and actionability when recent events include failures", () => {
    const signal = buildInitiativeSignal([event("tool.call.failed", 0.8)]);

    expect(signal.urgency).toBeGreaterThan(0.7);
    expect(signal.actionability).toBeGreaterThan(0.6);
    expect(signal.importance).toBe(0.8);
  });

  it("keeps quiet when there is no useful recent activity", () => {
    const signal = buildInitiativeSignal([]);

    expect(signal.urgency).toBeLessThan(0.1);
    expect(signal.uncertainty).toBeGreaterThan(0.6);
  });

  it("ignores internal proactive loop noise", () => {
    const signal = buildInitiativeSignal([event("initiative.tick", 0.95)]);

    expect(signal.importance).toBe(0);
    expect(signal.urgency).toBeLessThan(0.1);
  });
});
