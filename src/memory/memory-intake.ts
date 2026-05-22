import type { MemoryKind, MemoryStoreInput } from "./vector-memory-store.js";

export type MemoryCandidate = MemoryStoreInput & {
  reason: string;
};

const EXPLICIT_MEMORY_PATTERNS = [
  /记住/u,
  /记一下/u,
  /帮我记/u,
  /永久记忆/u,
  /\bremember\b/iu,
  /\bmake a note\b/iu,
];

const PREFERENCE_PATTERNS = [
  /我喜欢/u,
  /我不喜欢/u,
  /我希望/u,
  /我想要/u,
  /我要求/u,
  /我的偏好/u,
  /以后.+(都|要|不要|必须|只允许)/u,
  /\bi (like|prefer|want|need|hate|require)\b/iu,
  /\bmy preference\b/iu,
];

const IDENTITY_PATTERNS = [
  /我叫/u,
  /我的名字/u,
  /我是/u,
  /我的电脑/u,
  /我的显卡/u,
  /我的CPU/iu,
  /\bmy name is\b/iu,
  /\bi am\b/iu,
  /\bmy computer\b/iu,
];

const PROJECT_PATTERNS = [
  /项目/u,
  /目标/u,
  /架构/u,
  /方案/u,
  /贾维斯/u,
  /JARVIS/iu,
  /\bproject\b/iu,
  /\bgoal\b/iu,
  /\barchitecture\b/iu,
];

const SYSTEM_RULE_PATTERNS = [
  /每次/u,
  /永远/u,
  /必须/u,
  /不要/u,
  /只允许/u,
  /优先/u,
  /\balways\b/iu,
  /\bnever\b/iu,
  /\bmust\b/iu,
  /\bprefer\b/iu,
];

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isMostlyQuestion(text: string): boolean {
  const trimmed = text.trim();
  return /[?？]$/.test(trimmed) && !hasAny(trimmed, EXPLICIT_MEMORY_PATTERNS);
}

function cleanExplicitMemoryText(text: string): string {
  return text
    .replace(/^(请你|请|帮我)?(记住|记一下|帮我记|永久记忆)[:：,，\s]*/u, "")
    .replace(/^remember\s*[:：,，]?\s*(that\s+)?/iu, "")
    .trim();
}

function inferKind(text: string): MemoryKind {
  if (hasAny(text, SYSTEM_RULE_PATTERNS) && /JARVIS|贾维斯|系统|服务|模型|记忆/u.test(text)) {
    return "system";
  }
  if (hasAny(text, PREFERENCE_PATTERNS) || hasAny(text, SYSTEM_RULE_PATTERNS)) {
    return "preference";
  }
  if (hasAny(text, PROJECT_PATTERNS)) {
    return "project";
  }
  if (hasAny(text, IDENTITY_PATTERNS)) {
    return "relationship";
  }
  return "fact";
}

function candidateTags(kind: MemoryKind, explicit: boolean): string[] {
  const tags = ["auto-memory", kind];
  if (explicit) {
    tags.push("explicit");
  }
  return tags;
}

export function extractMemoryCandidates(message: string, sessionId: string): MemoryCandidate[] {
  const text = message.trim();
  if (text.length < 6 || isMostlyQuestion(text)) {
    return [];
  }

  const explicit = hasAny(text, EXPLICIT_MEMORY_PATTERNS);
  const salient =
    explicit ||
    hasAny(text, PREFERENCE_PATTERNS) ||
    hasAny(text, IDENTITY_PATTERNS) ||
    hasAny(text, PROJECT_PATTERNS) ||
    hasAny(text, SYSTEM_RULE_PATTERNS);

  if (!salient) {
    return [];
  }

  const cleaned = explicit ? cleanExplicitMemoryText(text) : text;
  if (cleaned.length < 4) {
    return [];
  }

  const kind = inferKind(cleaned);
  return [
    {
      text: cleaned,
      kind,
      scope: "global",
      tags: candidateTags(kind, explicit),
      importance: explicit ? 0.9 : kind === "system" || kind === "project" ? 0.78 : 0.68,
      confidence: explicit ? 0.92 : 0.78,
      source: "memory-intake",
      metadata: {
        sessionId,
        explicit,
        extractedAt: Date.now(),
      },
      reason: explicit ? "explicit memory request" : "salient long-term user signal",
    },
  ];
}
