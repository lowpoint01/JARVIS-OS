import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReflectionStore } from "./reflection-store.js";

async function withStore<T>(fn: (store: ReflectionStore) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-reflection-"));
  try {
    const store = new ReflectionStore(path.join(dir, "reflections.jsonl"));
    await store.initialize();
    return await fn(store);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("ReflectionStore", () => {
  it("records and finds lessons", async () => {
    await withStore(async (store) => {
      const result = await store.record({
        kind: "lesson",
        title: "Action rejected",
        summary: "Ask before repeating a risky action.",
        tags: ["action"],
      });

      expect(result.created).toBe(true);
      expect(store.find("risky")).toHaveLength(1);
    });
  });

  it("deduplicates source event reflections", async () => {
    await withStore(async (store) => {
      await store.record({
        kind: "failure",
        title: "Tool failed",
        summary: "boom",
        sourceEventId: "event-1",
      });
      const second = await store.record({
        kind: "failure",
        title: "Tool failed again",
        summary: "boom",
        sourceEventId: "event-1",
      });

      expect(second.created).toBe(false);
      expect(store.count()).toBe(1);
    });
  });

  it("deletes tagged synthetic reflections", async () => {
    await withStore(async (store) => {
      await store.record({
        kind: "lesson",
        title: "Full check reflection",
        summary: "Temporary verification record.",
        tags: ["full-check"],
      });

      const result = await store.deleteByTag("full-check");

      expect(result.deleted).toBe(1);
      expect(store.count()).toBe(0);
    });
  });

  it("deletes untagged synthetic full-check reflections", async () => {
    await withStore(async (store) => {
      await store.record({
        kind: "lesson",
        title: "Action rejected: demo.full-check.action",
        summary: "Do not repeat this action without better context: full check cleanup",
        tags: ["action"],
      });

      const result = await store.deleteSyntheticFullCheck();

      expect(result.deleted).toBe(1);
      expect(store.count()).toBe(0);
    });
  });

  it("deletes expected boundary failure reflections", async () => {
    await withStore(async (store) => {
      await store.record({
        kind: "failure",
        title: "Failure observed: tool.call.failed",
        summary: "File is too large to read safely (5059 bytes > 5000).",
        tags: ["runtime", "failure"],
      });
      await store.record({
        kind: "failure",
        title: "Failure observed: model.upstream_failed",
        summary: "HTTP 500",
        tags: ["runtime", "failure"],
      });

      const result = await store.deleteExpectedBoundaryFailures();

      expect(result.deleted).toBe(1);
      expect(store.count()).toBe(1);
    });
  });
});
