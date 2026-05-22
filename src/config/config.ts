import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { JarvisConfig } from "../shared/types.js";
import { loadOpenClawSecrets } from "./openclaw-import.js";

export type RuntimeSecrets = {
  moonshotApiKey?: string;
  volcengineApiKey?: string;
};

export type LoadedConfig = {
  rootDir: string;
  config: JarvisConfig;
  secrets: RuntimeSecrets;
};

type LocalSecretsFile = {
  moonshotApiKey?: string;
  volcengineApiKey?: string;
  asrCudaDllDirs?: string[];
};

function readYaml<T>(filePath: string): T {
  return parse(fs.readFileSync(filePath, "utf8")) as T;
}

function envSecret(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function envList(name: string): string[] | undefined {
  const value = process.env[name];
  if (!value?.trim()) {
    return undefined;
  }
  const items = value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function loadLocalSecretsFile(rootDir: string): LocalSecretsFile {
  const filePath = path.join(rootDir, "configs", "secrets.local.yaml");
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return readYaml<LocalSecretsFile>(filePath);
}

function loadLocalSecrets(rootDir: string): RuntimeSecrets {
  const local = loadLocalSecretsFile(rootDir);
  return {
    moonshotApiKey: local.moonshotApiKey?.trim() || undefined,
    volcengineApiKey: local.volcengineApiKey?.trim() || undefined,
  };
}

function applyLocalConfigOverrides(rootDir: string, config: JarvisConfig): JarvisConfig {
  const local = loadLocalSecretsFile(rootDir);
  const asrCudaDllDirs = envList("JARVIS_ASR_CUDA_DLL_DIRS") ?? local.asrCudaDllDirs;
  if (!asrCudaDllDirs?.length) {
    return config;
  }
  return {
    ...config,
    voice: {
      ...config.voice,
      asrCudaDllDirs,
    },
  };
}

function resolveSecrets(rootDir: string, config: JarvisConfig): RuntimeSecrets {
  const local = loadLocalSecrets(rootDir);
  const imported = config.secrets.importFromOpenClaw ? loadOpenClawSecrets() : {};
  return {
    moonshotApiKey:
      envSecret(config.models.chat.envKey) ?? local.moonshotApiKey ?? imported.moonshotApiKey,
    volcengineApiKey:
      envSecret(config.models.embedding.envKey) ??
      local.volcengineApiKey ??
      imported.volcengineApiKey,
  };
}

export function loadConfig(rootDir = process.cwd()): LoadedConfig {
  const configPath = path.join(rootDir, "configs", "config.yaml");
  const config = applyLocalConfigOverrides(rootDir, readYaml<JarvisConfig>(configPath));
  return {
    rootDir,
    config,
    secrets: resolveSecrets(rootDir, config),
  };
}

export function resolveProjectPath(rootDir: string, relativePath: string): string {
  return path.resolve(rootDir, relativePath);
}
