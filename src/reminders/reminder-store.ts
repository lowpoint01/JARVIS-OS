import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/id.js";

export type ReminderStatus = "scheduled" | "delivered" | "cancelled";

export type ReminderRecord = {
  id: string;
  title: string;
  message: string;
  dueAt: number;
  status: ReminderStatus;
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
  cancelledAt?: number;
  metadata: Record<string, unknown>;
};

export type CreateReminderInput = {
  title: string;
  message: string;
  dueAt: number;
  metadata?: Record<string, unknown>;
};

function publicRecord(record: ReminderRecord): ReminderRecord {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

export class ReminderStore {
  private records: ReminderRecord[] = [];
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
      .map((line) => JSON.parse(line) as ReminderRecord);
    this.initialized = true;
  }

  count(status?: ReminderStatus): number {
    this.assertInitialized();
    return status
      ? this.records.filter((record) => record.status === status).length
      : this.records.length;
  }

  async create(input: CreateReminderInput): Promise<ReminderRecord> {
    this.assertInitialized();
    const title = input.title.trim();
    const message = input.message.trim();
    if (!title || !message) {
      throw new Error("reminder requires non-empty title and message.");
    }
    if (!Number.isFinite(input.dueAt)) {
      throw new Error("reminder requires a valid dueAt timestamp.");
    }
    const now = Date.now();
    const record: ReminderRecord = {
      id: createId("rmd"),
      title,
      message,
      dueAt: input.dueAt,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    };
    this.records.push(record);
    await this.persistAll();
    return publicRecord(record);
  }

  due(now = Date.now(), limit = 25): ReminderRecord[] {
    this.assertInitialized();
    return this.records
      .filter((record) => record.status === "scheduled" && record.dueAt <= now)
      .sort((left, right) => left.dueAt - right.dueAt)
      .slice(0, Math.min(100, Math.max(1, limit)))
      .map(publicRecord);
  }

  list(status?: ReminderStatus, limit = 50): ReminderRecord[] {
    this.assertInitialized();
    return this.records
      .filter((record) => !status || record.status === status)
      .slice()
      .sort((left, right) => {
        if (left.status === "scheduled" && right.status === "scheduled") {
          return left.dueAt - right.dueAt;
        }
        return right.updatedAt - left.updatedAt;
      })
      .slice(0, Math.min(200, Math.max(1, limit)))
      .map(publicRecord);
  }

  async markDelivered(id: string): Promise<ReminderRecord> {
    const record = this.requireRecord(id);
    const now = Date.now();
    record.status = "delivered";
    record.deliveredAt = now;
    record.updatedAt = now;
    await this.persistAll();
    return publicRecord(record);
  }

  async cancel(id: string): Promise<ReminderRecord> {
    const record = this.requireRecord(id);
    if (record.status !== "scheduled") {
      throw new Error(`Reminder ${id} is not scheduled; current status is ${record.status}.`);
    }
    const now = Date.now();
    record.status = "cancelled";
    record.cancelledAt = now;
    record.updatedAt = now;
    await this.persistAll();
    return publicRecord(record);
  }

  private requireRecord(id: string): ReminderRecord {
    this.assertInitialized();
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) {
      throw new Error(`Reminder not found: ${id}`);
    }
    return record;
  }

  private async persistAll(): Promise<void> {
    const raw = this.records.map((record) => JSON.stringify(record)).join("\n");
    await fs.writeFile(this.filePath, raw ? `${raw}\n` : "", "utf8");
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("ReminderStore must be initialized before use.");
    }
  }
}
