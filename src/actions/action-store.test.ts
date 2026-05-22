import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionStore } from "./action-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-actions-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("ActionStore", () => {
  it("persists pending actions and transitions through approval", async () => {
    const store = new ActionStore(path.join(tempDir, "actions.jsonl"));
    await store.initialize();

    const pending = await store.createPending({
      toolName: "demo.tool",
      input: { ok: true },
      riskLevel: "L2",
      reason: "demo needs confirmation",
    });
    const approved = await store.approve(pending.id);
    const executed = await store.markExecuted(pending.id, { done: true });

    expect(pending.status).toBe("pending");
    expect(approved.status).toBe("approved");
    expect(executed.status).toBe("executed");
    expect(store.count()).toBe(1);
    expect(store.list("executed")).toHaveLength(1);
  });

  it("rejects only pending actions", async () => {
    const store = new ActionStore(path.join(tempDir, "actions.jsonl"));
    await store.initialize();

    const pending = await store.createPending({
      toolName: "demo.tool",
      input: {},
      riskLevel: "L3",
      reason: "demo",
    });
    await store.reject(pending.id, "no");

    await expect(store.approve(pending.id)).rejects.toThrow("not pending");
  });
});
