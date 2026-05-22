import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  type EmbeddingClient,
  VectorMemoryStore,
} from "./vector-memory-store.js";

let tempDir: string;

const fakeEmbedder: EmbeddingClient = {
  async embed(text: string) {
    const lower = text.toLowerCase();
    const embedding = lower.includes("blue")
      ? [1, 0, 0]
      : lower.includes("red")
        ? [0, 1, 0]
        : [0, 0, 1];
    return {
      model: "fake-embedding",
      dimensions: embedding.length,
      embedding,
    };
  },
};

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-memory-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("cosineSimilarity", () => {
  it("scores identical and orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});

describe("VectorMemoryStore", () => {
  it("stores and recalls vector memories without exposing raw embeddings", async () => {
    const store = new VectorMemoryStore(path.join(tempDir, "memories.jsonl"), fakeEmbedder);
    await store.initialize();

    await store.store({
      text: "The user's favorite dashboard color is blue.",
      kind: "preference",
      source: "test",
    });
    await store.store({
      text: "The emergency warning color is red.",
      kind: "fact",
      source: "test",
    });

    const result = await store.recall({ query: "blue theme", topK: 1, minScore: 0.1 });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.memory.text).toContain("blue");
    expect(result.matches[0]?.memory).not.toHaveProperty("embedding");
    expect(result.matches[0]?.memory.accessCount).toBe(1);
  });

  it("deduplicates near-identical memories in the same scope", async () => {
    const store = new VectorMemoryStore(path.join(tempDir, "memories.jsonl"), fakeEmbedder);
    await store.initialize();

    const first = await store.store({
      text: "Blue is preferred for calm UI panels.",
      kind: "preference",
      scope: "ui",
      importance: 0.4,
      source: "test",
    });
    const second = await store.store({
      text: "Blue is preferred for calm UI panels and status cards.",
      kind: "preference",
      scope: "ui",
      importance: 0.9,
      source: "test",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.duplicateOf).toBe(first.memory.id);
    expect(second.memory.importance).toBe(0.9);
    expect(await store.recent()).toHaveLength(1);
  });

  it("redacts secrets and mirrors memories into a markdown vault", async () => {
    const vaultDir = path.join(tempDir, "vault");
    const store = new VectorMemoryStore(path.join(tempDir, "memories.jsonl"), fakeEmbedder, {
      vaultDir,
    });
    await store.initialize();
    const fakeSecret = `sk-${"abcdefghijklmnopqrstuvwxyz123456"}`;

    const result = await store.store({
      text: `Remember token=${fakeSecret}`,
      kind: "system",
      source: "test",
    });
    const files = await fs.readdir(path.join(vaultDir, "system"));
    const markdown = await fs.readFile(path.join(vaultDir, "system", files[0] ?? ""), "utf8");

    expect(result.memory.text).toContain("[REDACTED:assignment_secret]");
    expect(markdown).toContain("[REDACTED:assignment_secret]");
    expect(markdown).not.toContain(fakeSecret);
    expect(store.vaultStatus()).toMatchObject({ enabled: true, records: 1 });
  });

  it("deletes tagged memories and removes stale vault files", async () => {
    const vaultDir = path.join(tempDir, "vault-clean");
    const store = new VectorMemoryStore(path.join(tempDir, "memories-clean.jsonl"), fakeEmbedder, {
      vaultDir,
    });
    await store.initialize();
    await store.store({
      text: "Full check temporary blue memory.",
      kind: "fact",
      scope: "full-check",
      tags: ["full-check"],
      source: "full-check",
    });

    const deleted = await store.deleteWhere({
      scope: "full-check",
      tag: "full-check",
      source: "full-check",
    });
    const files = await fs.readdir(vaultDir);

    expect(deleted.deleted).toBe(1);
    expect(await store.recent()).toHaveLength(0);
    expect(files).toHaveLength(0);
  });
});
