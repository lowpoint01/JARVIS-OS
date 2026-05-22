import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationStore, normalizeSessionId } from "./conversation-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-conversation-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("normalizeSessionId", () => {
  it("defaults empty session ids to main", () => {
    expect(normalizeSessionId("")).toBe("main");
    expect(normalizeSessionId(undefined)).toBe("main");
  });
});

describe("ConversationStore", () => {
  it("persists messages and lists sessions by recency", async () => {
    const store = new ConversationStore(tempDir);
    await store.initialize();

    await store.append({ sessionId: "main", role: "user", content: "hello" });
    await store.append({ sessionId: "main", role: "assistant", content: "hi" });
    await store.append({ sessionId: "other", role: "user", content: "later" });

    const main = await store.recent("main");
    const sessions = await store.listSessions();

    expect(main.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.sessionId).toBe("other");
  });
});
