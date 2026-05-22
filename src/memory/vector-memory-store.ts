import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/id.js";
import { redactSecrets } from "./secret-redaction.js";

export const MEMORY_KINDS = [
  "fact",
  "preference",
  "project",
  "episodic",
  "skill",
  "relationship",
  "system",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemoryRecord = {
  id: string;
  text: string;
  kind: MemoryKind;
  scope: string;
  tags: string[];
  importance: number;
  confidence: number;
  source: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt?: number;
  accessCount: number;
  embeddingModel: string;
  embeddingDimensions: number;
  embedding: number[];
  metadata: Record<string, unknown>;
};

export type MemoryView = Omit<MemoryRecord, "embedding">;

export type MemoryStoreInput = {
  text: string;
  kind?: MemoryKind;
  scope?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  source?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryRecallInput = {
  query: string;
  topK?: number;
  minScore?: number;
  scope?: string;
  kind?: MemoryKind;
};

export type MemoryStoreResult = {
  created: boolean;
  duplicateOf?: string;
  similarity?: number;
  memory: MemoryView;
};

export type MemoryRecallMatch = {
  score: number;
  memory: MemoryView;
};

export type MemoryRecallResult = {
  query: string;
  matches: MemoryRecallMatch[];
};

export type EmbeddingClient = {
  embed: (text: string) => Promise<{
    model: string;
    dimensions: number;
    embedding: number[];
  }>;
};

export type MemoryVaultStatus = {
  enabled: boolean;
  directory?: string;
  records: number;
};

export type MemoryDeleteFilter = {
  scope?: string;
  tag?: string;
  source?: string;
};

const DEFAULT_SCOPE = "global";
const DUPLICATE_THRESHOLD = 0.985;

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(
    new Set((tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0)),
  ).slice(0, 20);
}

function toMemoryView(record: MemoryRecord): MemoryView {
  const { embedding: _embedding, ...view } = record;
  return view;
}

function yamlList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `  - ${value}`).join("\n") : "  []";
}

function memoryMarkdown(record: MemoryRecord): string {
  return [
    "---",
    `id: ${record.id}`,
    `kind: ${record.kind}`,
    `scope: ${record.scope}`,
    `importance: ${record.importance}`,
    `confidence: ${record.confidence}`,
    `source: ${record.source}`,
    `createdAt: ${new Date(record.createdAt).toISOString()}`,
    `updatedAt: ${new Date(record.updatedAt).toISOString()}`,
    "tags:",
    yamlList(record.tags),
    "---",
    "",
    `# ${record.kind}: ${record.id}`,
    "",
    record.text,
    "",
    "## Metadata",
    "",
    "```json",
    JSON.stringify(record.metadata, null, 2),
    "```",
    "",
  ].join("\n");
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class VectorMemoryStore {
  private records: MemoryRecord[] = [];
  private initialized = false;

  constructor(
    private readonly filePath: string,
    private readonly embedder: EmbeddingClient,
    private readonly options: { vaultDir?: string } = {},
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, "", "utf8");
    }
    const raw = await fs.readFile(this.filePath, "utf8");
    this.records = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryRecord);
    this.initialized = true;
    await this.syncVault();
  }

  count(): number {
    return this.records.length;
  }

  async store(input: MemoryStoreInput): Promise<MemoryStoreResult> {
    this.assertInitialized();
    const redaction = redactSecrets(input.text.trim());
    const text = redaction.text.trim();
    if (!text) {
      throw new Error("memory.store requires non-empty text.");
    }

    const embedded = await this.embedder.embed(text);
    const scope = input.scope?.trim() || DEFAULT_SCOPE;
    const best = this.findBestMatch(embedded.embedding, {
      scope,
      kind: input.kind,
    });
    if (best && best.score >= DUPLICATE_THRESHOLD) {
      const now = Date.now();
      best.record.text = text.length > best.record.text.length ? text : best.record.text;
      best.record.tags = normalizeTags([...best.record.tags, ...(input.tags ?? [])]);
      best.record.importance = Math.max(
        best.record.importance,
        clamp01(input.importance ?? best.record.importance, best.record.importance),
      );
      best.record.confidence = Math.max(
        best.record.confidence,
        clamp01(input.confidence ?? best.record.confidence, best.record.confidence),
      );
      best.record.updatedAt = now;
      best.record.lastAccessedAt = now;
      best.record.accessCount += 1;
      best.record.metadata = {
        ...best.record.metadata,
        ...(input.metadata ?? {}),
        redactedCount:
          (typeof best.record.metadata.redactedCount === "number"
            ? best.record.metadata.redactedCount
            : 0) + redaction.redactedCount,
        redactionLabels: Array.from(
          new Set([
            ...((Array.isArray(best.record.metadata.redactionLabels)
              ? best.record.metadata.redactionLabels
              : []) as string[]),
            ...redaction.labels,
          ]),
        ),
      };
      await this.persistAll();
      return {
        created: false,
        duplicateOf: best.record.id,
        similarity: best.score,
        memory: toMemoryView(best.record),
      };
    }

    const now = Date.now();
    const record: MemoryRecord = {
      id: createId("mem"),
      text,
      kind: input.kind ?? "episodic",
      scope,
      tags: normalizeTags(input.tags),
      importance: clamp01(input.importance ?? 0.5, 0.5),
      confidence: clamp01(input.confidence ?? 0.7, 0.7),
      source: input.source?.trim() || "unknown",
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      embeddingModel: embedded.model,
      embeddingDimensions: embedded.dimensions,
      embedding: embedded.embedding,
      metadata: input.metadata ?? {},
    };
    if (redaction.redactedCount > 0) {
      record.metadata = {
        ...record.metadata,
        redactedCount: redaction.redactedCount,
        redactionLabels: redaction.labels,
      };
    }
    this.records.push(record);
    await this.persistAll();
    return {
      created: true,
      memory: toMemoryView(record),
    };
  }

  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    this.assertInitialized();
    const query = input.query.trim();
    if (!query) {
      throw new Error("memory.recall requires non-empty query.");
    }

    const embedded = await this.embedder.embed(query);
    const topK = Math.min(20, Math.max(1, Math.floor(input.topK ?? 8)));
    const minScore = clamp01(input.minScore ?? 0.45, 0.45);
    const matches = this.records
      .filter((record) => !input.scope || record.scope === input.scope)
      .filter((record) => !input.kind || record.kind === input.kind)
      .map((record) => ({
        record,
        score: cosineSimilarity(embedded.embedding, record.embedding),
      }))
      .filter((match) => match.score >= minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);

    if (matches.length > 0) {
      const now = Date.now();
      for (const match of matches) {
        match.record.lastAccessedAt = now;
        match.record.accessCount += 1;
      }
      await this.persistAll();
    }

    return {
      query,
      matches: matches.map((match) => ({
        score: match.score,
        memory: toMemoryView(match.record),
      })),
    };
  }

  async recent(limit = 20): Promise<MemoryView[]> {
    this.assertInitialized();
    return this.records
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.min(100, Math.max(1, limit)))
      .map(toMemoryView);
  }

  async deleteWhere(filter: MemoryDeleteFilter): Promise<{ deleted: number }> {
    this.assertInitialized();
    const before = this.records.length;
    this.records = this.records.filter((record) => {
      if (filter.scope && record.scope !== filter.scope) {
        return true;
      }
      if (filter.tag && !record.tags.includes(filter.tag)) {
        return true;
      }
      if (filter.source && record.source !== filter.source) {
        return true;
      }
      return false;
    });
    const deleted = before - this.records.length;
    if (deleted > 0) {
      await this.persistAll();
    }
    return { deleted };
  }

  vaultStatus(): MemoryVaultStatus {
    this.assertInitialized();
    return {
      enabled: Boolean(this.options.vaultDir),
      directory: this.options.vaultDir,
      records: this.records.length,
    };
  }

  private findBestMatch(
    embedding: number[],
    filter: { scope: string; kind?: MemoryKind },
  ): { record: MemoryRecord; score: number } | undefined {
    let best: { record: MemoryRecord; score: number } | undefined;
    for (const record of this.records) {
      if (record.scope !== filter.scope) {
        continue;
      }
      if (filter.kind && record.kind !== filter.kind) {
        continue;
      }
      const score = cosineSimilarity(embedding, record.embedding);
      if (!best || score > best.score) {
        best = { record, score };
      }
    }
    return best;
  }

  private async persistAll(): Promise<void> {
    const raw = this.records.map((record) => JSON.stringify(record)).join("\n");
    await fs.writeFile(this.filePath, raw ? `${raw}\n` : "", "utf8");
    await this.syncVault();
  }

  private async syncVault(): Promise<void> {
    if (!this.options.vaultDir) {
      return;
    }
    await fs.rm(this.options.vaultDir, { recursive: true, force: true });
    await fs.mkdir(this.options.vaultDir, { recursive: true });
    for (const record of this.records) {
      const directory = path.join(this.options.vaultDir, record.kind);
      await fs.mkdir(directory, { recursive: true });
      const filePath = path.join(directory, `${record.createdAt}-${record.id}.md`);
      await fs.writeFile(filePath, memoryMarkdown(record), "utf8");
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("VectorMemoryStore must be initialized before use.");
    }
  }
}
