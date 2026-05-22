import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlEventStore } from "./event-store.js";

describe("JsonlEventStore", () => {
  it("appends and reads recent events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-events-"));
    const store = new JsonlEventStore(path.join(dir, "events.jsonl"));
    await store.initialize();
    await store.append({
      type: "test.one",
      source: "test",
      importance: 0.1,
      payload: { value: 1 },
    });
    await store.append({
      type: "test.two",
      source: "test",
      importance: 0.2,
      payload: { value: 2 },
    });
    const recent = await store.recent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.type).toBe("test.two");
  });
});
