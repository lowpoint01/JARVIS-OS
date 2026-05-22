import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/id.js";

export type ReflectionKind = "success" | "failure" | "lesson" | "policy_suggestion";

export type ReflectionRecord = {
  id: string;
  kind: ReflectionKind;
  title: string;
  summary: string;
  tags: string[];
  sourceEventId?: string;
  confidence: number;
  createdAt: number;
  metadata: Record<string, unknown>;
};

export type RecordReflectionInput = {
  kind?: ReflectionKind;
  title: string;
  summary: string;
  tags?: string[];
  sourceEventId?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

function clamp01(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value as number));
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function publicRecord(record: ReflectionRecord): ReflectionRecord {
  return {
    ...record,
    tags: record.tags.slice(),
    metadata: { ...record.metadata },
  };
}

export class ReflectionStore {
  private records: ReflectionRecord[] = [];
  private initialized = false;

  constructor(private readonly filePath: string) {}

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
      .map((line) => JSON.parse(line) as ReflectionRecord);
    this.initialized = true;
  }

  count(): number {
    this.assertInitialized();
    return this.records.length;
  }

  async record(input: RecordReflectionInput): Promise<{ created: boolean; reflection: ReflectionRecord }> {
    this.assertInitialized();
    const title = normalize(input.title);
    const summary = normalize(input.summary);
    if (!title || !summary) {
      throw new Error("Reflection title and summary are required.");
    }
    if (input.sourceEventId) {
      const existing = this.records.find(
        (record) => record.sourceEventId === input.sourceEventId && record.kind === (input.kind ?? "lesson"),
      );
      if (existing) {
        return { created: false, reflection: publicRecord(existing) };
      }
    }
    const reflection: ReflectionRecord = {
      id: createId("rfl"),
      kind: input.kind ?? "lesson",
      title,
      summary,
      tags: Array.from(new Set((input.tags ?? []).map(normalize))).filter(Boolean),
      sourceEventId: input.sourceEventId,
      confidence: clamp01(input.confidence, 0.75),
      createdAt: Date.now(),
      metadata: { ...(input.metadata ?? {}) },
    };
    this.records.push(reflection);
    await this.append(reflection);
    return { created: true, reflection: publicRecord(reflection) };
  }

  list(limit = 50, kind?: ReflectionKind): ReflectionRecord[] {
    this.assertInitialized();
    return this.records
      .filter((record) => !kind || record.kind === kind)
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, Math.min(200, Math.max(1, limit)))
      .map(publicRecord);
  }

  find(query: string, limit = 10): ReflectionRecord[] {
    this.assertInitialized();
    const normalized = normalize(query).toLowerCase();
    if (!normalized) {
      return this.list(limit);
    }
    return this.records
      .map((record) => ({
        record,
        score: this.score(record, normalized),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || right.record.createdAt - left.record.createdAt)
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map((item) => publicRecord(item.record));
  }

  async deleteByTag(tag: string): Promise<{ deleted: number }> {
    this.assertInitialized();
    const before = this.records.length;
    this.records = this.records.filter((record) => !record.tags.includes(tag));
    const deleted = before - this.records.length;
    if (deleted > 0) {
      await this.persistAll();
    }
    return { deleted };
  }

  async deleteSyntheticFullCheck(): Promise<{ deleted: number }> {
    this.assertInitialized();
    const before = this.records.length;
    this.records = this.records.filter((record) => !isSyntheticFullCheckReflection(record));
    const deleted = before - this.records.length;
    if (deleted > 0) {
      await this.persistAll();
    }
    return { deleted };
  }

  async deleteExpectedBoundaryFailures(): Promise<{ deleted: number }> {
    this.assertInitialized();
    const before = this.records.length;
    this.records = this.records.filter((record) => !isExpectedBoundaryFailureReflection(record));
    const deleted = before - this.records.length;
    if (deleted > 0) {
      await this.persistAll();
    }
    return { deleted };
  }

  private score(record: ReflectionRecord, query: string): number {
    const haystack = [
      record.kind,
      record.title,
      record.summary,
      ...record.tags,
      ...Object.values(record.metadata)
        .filter((value) => typeof value === "string" || typeof value === "number")
        .map(String),
    ]
      .join(" ")
      .toLowerCase();
    if (record.title.toLowerCase() === query) {
      return 10;
    }
    if (record.title.toLowerCase().includes(query)) {
      return 6;
    }
    if (haystack.includes(query)) {
      return 3;
    }
    const terms = query.split(/\s+/).filter(Boolean);
    return terms.filter((term) => haystack.includes(term)).length;
  }

  private async append(record: ReflectionRecord): Promise<void> {
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  private async persistAll(): Promise<void> {
    const raw = this.records.map((record) => JSON.stringify(record)).join("\n");
    await fs.writeFile(this.filePath, raw ? `${raw}\n` : "", "utf8");
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("ReflectionStore must be initialized before use.");
    }
  }
}

function isSyntheticFullCheckReflection(record: ReflectionRecord): boolean {
  if (record.tags.includes("full-check")) {
    return true;
  }
  const values = [
    record.title,
    record.summary,
    ...record.tags,
    ...Object.values(record.metadata)
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map(String),
  ]
    .join(" ")
    .toLowerCase();
  return values.includes("full check") || values.includes("full-check");
}

function isExpectedBoundaryFailureReflection(record: ReflectionRecord): boolean {
  if (record.kind !== "failure") {
    return false;
  }
  const values = [
    record.title,
    record.summary,
    ...record.tags,
    ...Object.values(record.metadata)
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map(String),
  ]
    .join(" ")
    .toLowerCase();
  return [
    "too large to read safely",
    "requires {",
    "requires non-empty",
    "outside configured",
    "inside an excluded segment",
    "refusing to read",
    "not pending",
    "not found",
  ].some((pattern) => values.includes(pattern));
}
