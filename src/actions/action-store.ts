import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/id.js";
import type { RiskLevel } from "../shared/types.js";

export type ActionStatus = "pending" | "approved" | "executed" | "rejected" | "failed";

export type ActionRecord = {
  id: string;
  toolName: string;
  input: unknown;
  riskLevel: RiskLevel;
  status: ActionStatus;
  reason: string;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  rejectedAt?: number;
  executedAt?: number;
  result?: unknown;
  error?: string;
  audit: Array<{
    at: number;
    event: string;
    detail?: string;
  }>;
};

export type CreatePendingActionInput = {
  toolName: string;
  input: unknown;
  riskLevel: RiskLevel;
  reason: string;
};

function publicRecord(record: ActionRecord): ActionRecord {
  return {
    ...record,
    audit: record.audit.slice(),
  };
}

export class ActionStore {
  private records: ActionRecord[] = [];
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
      .map((line) => JSON.parse(line) as ActionRecord);
    this.initialized = true;
  }

  count(status?: ActionStatus): number {
    this.assertInitialized();
    return status ? this.records.filter((record) => record.status === status).length : this.records.length;
  }

  async createPending(input: CreatePendingActionInput): Promise<ActionRecord> {
    this.assertInitialized();
    const now = Date.now();
    const record: ActionRecord = {
      id: createId("act"),
      toolName: input.toolName,
      input: input.input,
      riskLevel: input.riskLevel,
      status: "pending",
      reason: input.reason,
      createdAt: now,
      updatedAt: now,
      audit: [{ at: now, event: "created", detail: input.reason }],
    };
    this.records.push(record);
    await this.persistAll();
    return publicRecord(record);
  }

  list(status?: ActionStatus, limit = 50): ActionRecord[] {
    this.assertInitialized();
    return this.records
      .filter((record) => !status || record.status === status)
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.min(200, Math.max(1, limit)))
      .map(publicRecord);
  }

  get(id: string): ActionRecord | undefined {
    this.assertInitialized();
    const record = this.records.find((candidate) => candidate.id === id);
    return record ? publicRecord(record) : undefined;
  }

  async approve(id: string): Promise<ActionRecord> {
    const record = this.requireRecord(id);
    if (record.status !== "pending") {
      throw new Error(`Action ${id} is not pending; current status is ${record.status}.`);
    }
    const now = Date.now();
    record.status = "approved";
    record.approvedAt = now;
    record.updatedAt = now;
    record.audit.push({ at: now, event: "approved" });
    await this.persistAll();
    return publicRecord(record);
  }

  async reject(id: string, reason?: string): Promise<ActionRecord> {
    const record = this.requireRecord(id);
    if (record.status !== "pending") {
      throw new Error(`Action ${id} is not pending; current status is ${record.status}.`);
    }
    const now = Date.now();
    record.status = "rejected";
    record.rejectedAt = now;
    record.updatedAt = now;
    record.audit.push({ at: now, event: "rejected", detail: reason });
    await this.persistAll();
    return publicRecord(record);
  }

  async markExecuted(id: string, result: unknown): Promise<ActionRecord> {
    const record = this.requireRecord(id);
    const now = Date.now();
    record.status = "executed";
    record.executedAt = now;
    record.updatedAt = now;
    record.result = result;
    record.audit.push({ at: now, event: "executed" });
    await this.persistAll();
    return publicRecord(record);
  }

  async markFailed(id: string, error: string): Promise<ActionRecord> {
    const record = this.requireRecord(id);
    const now = Date.now();
    record.status = "failed";
    record.updatedAt = now;
    record.error = error;
    record.audit.push({ at: now, event: "failed", detail: error });
    await this.persistAll();
    return publicRecord(record);
  }

  private requireRecord(id: string): ActionRecord {
    this.assertInitialized();
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) {
      throw new Error(`Action not found: ${id}`);
    }
    return record;
  }

  private async persistAll(): Promise<void> {
    const raw = this.records.map((record) => JSON.stringify(record)).join("\n");
    await fs.writeFile(this.filePath, raw ? `${raw}\n` : "", "utf8");
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("ActionStore must be initialized before use.");
    }
  }
}
