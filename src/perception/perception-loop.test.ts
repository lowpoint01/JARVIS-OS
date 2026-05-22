import { describe, expect, it } from "vitest";
import type { JarvisEvent } from "../shared/types.js";
import { PerceptionLoop, type SystemResourceSample } from "./perception-loop.js";

function sample(freeRatio = 0.5): SystemResourceSample {
  const total = 1000;
  const free = Math.round(total * freeRatio);
  return {
    timestamp: 123,
    platform: "win32",
    arch: "x64",
    cpuCount: 24,
    loadAverage: [0, 0, 0],
    memory: {
      free,
      total,
      used: total - free,
      freeRatio,
      usedRatio: 1 - freeRatio,
    },
    process: {
      pid: 1,
      uptimeMs: 100,
      rss: 10,
      heapUsed: 5,
      heapTotal: 8,
      external: 1,
    },
  };
}

describe("PerceptionLoop", () => {
  it("emits a system sample on every tick", async () => {
    const events: Array<Omit<JarvisEvent<unknown>, "id" | "timestamp">> = [];
    const loop = new PerceptionLoop({
      config: {
        tickMs: 5000,
        memoryWarningFreeRatio: 0.1,
        eventImportance: 0.25,
      },
      sample: () => sample(0.5),
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    await loop.tick();

    expect(loop.status().tickCount).toBe(1);
    expect(events.map((event) => event.type)).toEqual(["perception.system_sample"]);
  });

  it("emits a resource warning when free memory is under the configured threshold", async () => {
    const events: Array<Omit<JarvisEvent<unknown>, "id" | "timestamp">> = [];
    const loop = new PerceptionLoop({
      config: {
        tickMs: 5000,
        memoryWarningFreeRatio: 0.2,
        eventImportance: 0.25,
      },
      sample: () => sample(0.05),
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    await loop.tick();

    expect(loop.status().lastWarning?.type).toBe("low_memory");
    expect(events.map((event) => event.type)).toEqual([
      "perception.system_sample",
      "perception.resource_warning",
    ]);
  });
});
