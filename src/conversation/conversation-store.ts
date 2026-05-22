import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/id.js";

export type ConversationRole = "user" | "assistant" | "system" | "tool";

export type ConversationMessage = {
  id: string;
  sessionId: string;
  role: ConversationRole;
  content: string;
  createdAt: number;
  metadata: Record<string, unknown>;
};

export type ConversationSessionSummary = {
  sessionId: string;
  messageCount: number;
  lastMessageAt?: number;
};

export type AppendConversationMessageInput = {
  sessionId?: string;
  role: ConversationRole;
  content: string;
  metadata?: Record<string, unknown>;
};

const DEFAULT_SESSION_ID = "main";

export function normalizeSessionId(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_SESSION_ID;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SESSION_ID;
  }
  return trimmed.slice(0, 128);
}

function sessionFileName(sessionId: string): string {
  return `${encodeURIComponent(sessionId)}.jsonl`;
}

function sessionIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(".jsonl")) {
    return undefined;
  }
  try {
    return decodeURIComponent(fileName.slice(0, -".jsonl".length));
  } catch {
    return undefined;
  }
}

export class ConversationStore {
  private lastCreatedAt = 0;

  constructor(private readonly rootDir: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async append(input: AppendConversationMessageInput): Promise<ConversationMessage> {
    const content = input.content.trim();
    if (!content) {
      throw new Error("conversation message content cannot be empty.");
    }
    const now = Date.now();
    const createdAt = Math.max(now, this.lastCreatedAt + 1);
    this.lastCreatedAt = createdAt;
    const message: ConversationMessage = {
      id: createId("msg"),
      sessionId: normalizeSessionId(input.sessionId),
      role: input.role,
      content,
      createdAt,
      metadata: input.metadata ?? {},
    };
    await fs.appendFile(this.filePath(message.sessionId), `${JSON.stringify(message)}\n`, "utf8");
    return message;
  }

  async recent(sessionIdInput?: string, limit = 30): Promise<ConversationMessage[]> {
    const sessionId = normalizeSessionId(sessionIdInput);
    const messages = await this.readSession(sessionId);
    return messages.slice(-Math.min(100, Math.max(1, limit)));
  }

  async listSessions(): Promise<ConversationSessionSummary[]> {
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const summaries: ConversationSessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const sessionId = sessionIdFromFileName(entry.name);
      if (!sessionId) {
        continue;
      }
      const messages = await this.readSession(sessionId);
      summaries.push({
        sessionId,
        messageCount: messages.length,
        lastMessageAt: messages.at(-1)?.createdAt,
      });
    }
    return summaries.sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0));
  }

  private async readSession(sessionId: string): Promise<ConversationMessage[]> {
    try {
      const raw = await fs.readFile(this.filePath(sessionId), "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ConversationMessage);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  private filePath(sessionId: string): string {
    return path.join(this.rootDir, sessionFileName(sessionId));
  }
}
