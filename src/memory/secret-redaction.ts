export type RedactionResult = {
  text: string;
  redactedCount: number;
  labels: string[];
};

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "moonshot_key", pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  {
    label: "uuid_bearer",
    pattern: /\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\b/g,
  },
  {
    label: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  },
  {
    label: "assignment_secret",
    pattern: /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"',\s]{8,}/gi,
  },
];

export function redactSecrets(text: string): RedactionResult {
  let redacted = text;
  let redactedCount = 0;
  const labels = new Set<string>();
  for (const { label, pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      redactedCount += 1;
      labels.add(label);
      return `[REDACTED:${label}]`;
    });
  }
  return {
    text: redacted,
    redactedCount,
    labels: Array.from(labels),
  };
}
