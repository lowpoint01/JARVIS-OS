import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/id.js";

export type NotificationLevel = "info" | "suggestion" | "warning" | "critical";
export type NotificationStatus = "unread" | "read" | "dismissed";

export type NotificationRecord = {
  id: string;
  level: NotificationLevel;
  title: string;
  message: string;
  source: string;
  status: NotificationStatus;
  createdAt: number;
  updatedAt: number;
  readAt?: number;
  dismissedAt?: number;
  actionId?: string;
  dedupeKey?: string;
  occurrenceCount: number;
  metadata: Record<string, unknown>;
};

export type CreateNotificationInput = {
  level: NotificationLevel;
  title: string;
  message: string;
  source: string;
  actionId?: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
};

function publicRecord(record: NotificationRecord): NotificationRecord {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

export class NotificationStore {
  private records: NotificationRecord[] = [];
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
      .map((line) => JSON.parse(line) as NotificationRecord);
    this.initialized = true;
  }

  count(status?: NotificationStatus): number {
    this.assertInitialized();
    return status
      ? this.records.filter((record) => record.status === status).length
      : this.records.length;
  }

  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    this.assertInitialized();
    const title = input.title.trim();
    const message = input.message.trim();
    if (!title || !message) {
      throw new Error("notification requires non-empty title and message.");
    }

    const existing =
      input.dedupeKey &&
      this.records.find(
        (record) => record.status === "unread" && record.dedupeKey === input.dedupeKey,
      );
    if (existing) {
      existing.level = input.level;
      existing.title = title;
      existing.message = message;
      existing.updatedAt = Date.now();
      existing.occurrenceCount += 1;
      existing.actionId = input.actionId ?? existing.actionId;
      existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
      await this.persistAll();
      return publicRecord(existing);
    }

    const now = Date.now();
    const record: NotificationRecord = {
      id: createId("ntf"),
      level: input.level,
      title,
      message,
      source: input.source,
      status: "unread",
      createdAt: now,
      updatedAt: now,
      actionId: input.actionId,
      dedupeKey: input.dedupeKey,
      occurrenceCount: 1,
      metadata: input.metadata ?? {},
    };
    this.records.push(record);
    await this.persistAll();
    return publicRecord(record);
  }

  list(status?: NotificationStatus, limit = 50): NotificationRecord[] {
    this.assertInitialized();
    return this.records
      .filter((record) => !status || record.status === status)
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.min(200, Math.max(1, limit)))
      .map(publicRecord);
  }

  async markRead(id: string): Promise<NotificationRecord> {
    const record = this.requireRecord(id);
    const now = Date.now();
    record.status = "read";
    record.readAt = now;
    record.updatedAt = now;
    await this.persistAll();
    return publicRecord(record);
  }

  async dismiss(id: string): Promise<NotificationRecord> {
    const record = this.requireRecord(id);
    const now = Date.now();
    record.status = "dismissed";
    record.dismissedAt = now;
    record.updatedAt = now;
    await this.persistAll();
    return publicRecord(record);
  }

  private requireRecord(id: string): NotificationRecord {
    this.assertInitialized();
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) {
      throw new Error(`Notification not found: ${id}`);
    }
    return record;
  }

  private async persistAll(): Promise<void> {
    const raw = this.records.map((record) => JSON.stringify(record)).join("\n");
    await fs.writeFile(this.filePath, raw ? `${raw}\n` : "", "utf8");
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("NotificationStore must be initialized before use.");
    }
  }
}
