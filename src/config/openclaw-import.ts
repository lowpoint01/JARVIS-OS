import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type OpenClawImport = {
  moonshotApiKey?: string;
  volcengineApiKey?: string;
};

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nested(root: unknown, keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    current = asRecord(current)?.[key];
  }
  return current;
}

export function loadOpenClawSecrets(): OpenClawImport {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const cfg = readJson(configPath);
    return {
      moonshotApiKey: stringValue(nested(cfg, ["models", "providers", "moonshot", "apiKey"])),
      volcengineApiKey: stringValue(
        nested(cfg, ["plugins", "entries", "memory-lancedb", "config", "embedding", "apiKey"]),
      ),
    };
  } catch {
    return {};
  }
}
