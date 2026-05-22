import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReminderStore } from "./reminder-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-reminders-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("ReminderStore", () => {
  it("creates due reminders and marks them delivered", async () => {
    const store = new ReminderStore(path.join(tempDir, "reminders.jsonl"));
    await store.initialize();

    const reminder = await store.create({
      title: "Stand up",
      message: "Move around.",
      dueAt: 1000,
    });

    expect(store.due(999)).toHaveLength(0);
    expect(store.due(1000)).toHaveLength(1);
    await store.markDelivered(reminder.id);
    expect(store.due(2000)).toHaveLength(0);
    expect(store.count("delivered")).toBe(1);
  });

  it("cancels scheduled reminders", async () => {
    const store = new ReminderStore(path.join(tempDir, "reminders.jsonl"));
    await store.initialize();

    const reminder = await store.create({
      title: "Cancel me",
      message: "No-op.",
      dueAt: Date.now() + 10_000,
    });
    await store.cancel(reminder.id);

    expect(store.count("cancelled")).toBe(1);
  });
});
