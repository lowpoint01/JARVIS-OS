import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "../events/event-store.js";
import { ReflectionLoop } from "./reflection-loop.js";
import { ReflectionStore } from "./reflection-store.js";

describe("ReflectionLoop", () => {
  it("turns rejected actions into lessons", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-reflection-loop-"));
    try {
      const eventStore = new JsonlEventStore(path.join(dir, "events.jsonl"));
      const reflectionStore = new ReflectionStore(path.join(dir, "reflections.jsonl"));
      await eventStore.initialize();
      await reflectionStore.initialize();
      await eventStore.append({
        type: "action.rejected",
        source: "tool-runtime",
        importance: 0.45,
        payload: {
          toolName: "powershell.run",
          reason: "not now",
        },
      });
      const loop = new ReflectionLoop({
        config: {
          tickMs: 5000,
          chatLatencyWarningMs: 8000,
        },
        eventStore,
        reflectionStore,
        emitEvent: async () => {},
      });

      const recorded = await loop.tick();

      expect(recorded).toBe(1);
      expect(reflectionStore.find("powershell")).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores synthetic full-check events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-reflection-loop-"));
    try {
      const eventStore = new JsonlEventStore(path.join(dir, "events.jsonl"));
      const reflectionStore = new ReflectionStore(path.join(dir, "reflections.jsonl"));
      await eventStore.initialize();
      await reflectionStore.initialize();
      await eventStore.append({
        type: "action.rejected",
        source: "tool-runtime",
        importance: 0.45,
        payload: {
          toolName: "powershell.run",
          reason: "full check cleanup",
        },
      });
      const loop = new ReflectionLoop({
        config: {
          tickMs: 5000,
          chatLatencyWarningMs: 8000,
        },
        eventStore,
        reflectionStore,
        emitEvent: async () => {},
      });

      const recorded = await loop.tick();

      expect(recorded).toBe(0);
      expect(reflectionStore.list()).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores expected tool boundary failures", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-reflection-loop-"));
    try {
      const eventStore = new JsonlEventStore(path.join(dir, "events.jsonl"));
      const reflectionStore = new ReflectionStore(path.join(dir, "reflections.jsonl"));
      await eventStore.initialize();
      await reflectionStore.initialize();
      await eventStore.append({
        type: "tool.call.failed",
        source: "tool-runtime",
        importance: 0.65,
        payload: {
          name: "files.read",
          error: "File is too large to read safely (5059 bytes > 5000).",
        },
      });
      const loop = new ReflectionLoop({
        config: {
          tickMs: 5000,
          chatLatencyWarningMs: 8000,
        },
        eventStore,
        reflectionStore,
        emitEvent: async () => {},
      });

      const recorded = await loop.tick();

      expect(recorded).toBe(0);
      expect(reflectionStore.list()).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
