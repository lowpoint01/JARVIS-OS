import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotificationStore } from "./notification-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-notifications-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("NotificationStore", () => {
  it("creates, reads, and dismisses notifications", async () => {
    const store = new NotificationStore(path.join(tempDir, "notifications.jsonl"));
    await store.initialize();

    const created = await store.create({
      level: "warning",
      title: "Action needed",
      message: "Approve something.",
      source: "test",
    });
    expect(store.count("unread")).toBe(1);

    const read = await store.markRead(created.id);
    expect(read.status).toBe("read");

    const dismissed = await store.dismiss(created.id);
    expect(dismissed.status).toBe("dismissed");
    expect(store.count("unread")).toBe(0);
  });

  it("deduplicates unread notifications with the same key", async () => {
    const store = new NotificationStore(path.join(tempDir, "notifications.jsonl"));
    await store.initialize();

    await store.create({
      level: "warning",
      title: "Model issue",
      message: "First",
      source: "test",
      dedupeKey: "model",
    });
    const second = await store.create({
      level: "critical",
      title: "Model issue",
      message: "Second",
      source: "test",
      dedupeKey: "model",
    });

    expect(store.count("unread")).toBe(1);
    expect(second.occurrenceCount).toBe(2);
    expect(second.message).toBe("Second");
  });
});
