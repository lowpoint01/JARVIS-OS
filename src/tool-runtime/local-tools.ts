import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { JarvisConfig, ToolDefinition } from "../shared/types.js";

type LocalToolRuntimeOptions = {
  rootDir: string;
  config: JarvisConfig["toolRuntime"];
};

type SafePath = {
  absolutePath: string;
  relativePath: string;
};

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /secret/i,
  /credential/i,
  /token/i,
  /api[-_]?key/i,
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, typeof value === "number" && Number.isFinite(value) ? value : fallback));
}

function within(parent: string, candidate: string): boolean {
  const parentResolved = path.resolve(parent);
  const candidateResolved = path.resolve(candidate);
  return (
    candidateResolved === parentResolved ||
    candidateResolved.startsWith(`${parentResolved}${path.sep}`)
  );
}

function allowedRoots(options: LocalToolRuntimeOptions): string[] {
  return options.config.allowedRoots.map((root) =>
    path.resolve(options.rootDir, root),
  );
}

function isSensitiveFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(base));
}

function hasExcludedSegment(filePath: string, options: LocalToolRuntimeOptions): boolean {
  const segments = path.resolve(filePath).split(/[\\/]+/);
  return segments.some((segment) => options.config.excludedSegments.includes(segment));
}

function safePath(inputPath: unknown, options: LocalToolRuntimeOptions): SafePath {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("A non-empty path is required.");
  }
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(options.rootDir, inputPath);
  const root = allowedRoots(options).find((allowedRoot) => within(allowedRoot, candidate));
  if (!root) {
    throw new Error("Path is outside configured toolRuntime.allowedRoots.");
  }
  if (hasExcludedSegment(candidate, options)) {
    throw new Error("Path is inside an excluded segment.");
  }
  if (isSensitiveFile(candidate)) {
    throw new Error("Refusing to read or operate on sensitive local secret material.");
  }
  return {
    absolutePath: candidate,
    relativePath: path.relative(options.rootDir, candidate) || ".",
  };
}

async function walkFiles(
  directory: string,
  options: LocalToolRuntimeOptions,
  limit: number,
  output: string[],
): Promise<void> {
  if (output.length >= limit || hasExcludedSegment(directory, options)) {
    return;
  }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= limit) {
      return;
    }
    const absolutePath = path.join(directory, entry.name);
    if (hasExcludedSegment(absolutePath, options) || isSensitiveFile(absolutePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      await walkFiles(absolutePath, options, limit, output);
      continue;
    }
    if (entry.isFile()) {
      output.push(absolutePath);
    }
  }
}

function isTextBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let controlCount = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) {
      controlCount += 1;
    }
  }
  return controlCount / Math.max(1, sample.length) < 0.05;
}

function dangerousPowerShell(command: string): boolean {
  return [
    /\bRemove-Item\b[\s\S]*\s-(?:Recurse|Force)\b/i,
    /\bFormat-Volume\b/i,
    /\bClear-Disk\b/i,
    /\bReset-ComputerMachinePassword\b/i,
    /\bStop-Computer\b/i,
    /\bRestart-Computer\b/i,
    /\biex\b|\bInvoke-Expression\b/i,
  ].some((pattern) => pattern.test(command));
}

async function runPowerShell(command: string, timeoutMs: number): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode,
          stdout,
          stderr,
          timedOut: false,
        });
      }
    });
  });
}

async function openTarget(target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Start-Process $args[0]",
      target,
    ], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
}

export function buildLocalRuntimeTools(options: LocalToolRuntimeOptions): ToolDefinition[] {
  return [
    {
      name: "files.search",
      description: "Search safe local project files by path substring and optional extension.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const root = safePath(body?.root ?? ".", options);
        const query = typeof body?.query === "string" ? body.query.toLowerCase() : "";
        const extension =
          typeof body?.extension === "string" && body.extension.trim()
            ? body.extension.trim().replace(/^\./, "").toLowerCase()
            : undefined;
        const limit = normalizeLimit(body?.limit, options.config.searchLimit, 200);
        const files: string[] = [];
        await walkFiles(root.absolutePath, options, limit, files);
        return files
          .filter((filePath) => {
            const relative = path.relative(options.rootDir, filePath);
            return (
              (!query || relative.toLowerCase().includes(query)) &&
              (!extension || path.extname(filePath).toLowerCase() === `.${extension}`)
            );
          })
          .slice(0, limit)
          .map((filePath) => ({
            path: path.relative(options.rootDir, filePath),
            bytes: 0,
          }));
      },
    },
    {
      name: "files.read",
      description: "Read a safe local text file under configured allowed roots.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const target = safePath(body?.path, options);
        const stat = await fs.stat(target.absolutePath);
        if (!stat.isFile()) {
          throw new Error("files.read only supports regular files.");
        }
        const maxBytes = normalizeLimit(body?.maxBytes, options.config.maxReadBytes, options.config.maxReadBytes);
        if (stat.size > maxBytes) {
          throw new Error(`File is too large to read safely (${stat.size} bytes > ${maxBytes}).`);
        }
        const buffer = await fs.readFile(target.absolutePath);
        if (!isTextBuffer(buffer)) {
          return {
            path: target.relativePath,
            bytes: buffer.byteLength,
            binary: true,
            content: "",
          };
        }
        return {
          path: target.relativePath,
          bytes: buffer.byteLength,
          binary: false,
          content: buffer.toString("utf8"),
        };
      },
    },
    {
      name: "files.backup",
      description: "Create a timestamped backup copy of a safe local file.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const target = safePath(body?.path, options);
        const stat = await fs.stat(target.absolutePath);
        if (!stat.isFile()) {
          throw new Error("files.backup only supports regular files.");
        }
        const backupRoot = path.resolve(options.rootDir, "data", "backups");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const destination = path.join(
          backupRoot,
          `${target.relativePath.replace(/[\\/]/g, "__")}.${stamp}.bak`,
        );
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(target.absolutePath, destination);
        return {
          source: target.relativePath,
          backup: path.relative(options.rootDir, destination),
          bytes: stat.size,
        };
      },
    },
    {
      name: "desktop.open",
      description: "Open a safe local path or http(s) URL with the desktop default app.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.target !== "string" || !body.target.trim()) {
          throw new Error("desktop.open requires { target: string }.");
        }
        const target = body.target.trim();
        const url = URL.canParse(target) ? new URL(target) : undefined;
        if (url && (url.protocol === "http:" || url.protocol === "https:")) {
          await openTarget(url.toString());
          return { opened: url.toString(), type: "url" };
        }
        const local = safePath(target, options);
        await openTarget(local.absolutePath);
        return { opened: local.relativePath, type: "path" };
      },
    },
    {
      name: "powershell.run",
      description: "Run a PowerShell command after explicit user approval.",
      riskLevel: "L3",
      requiresConfirmation: true,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.command !== "string" || !body.command.trim()) {
          throw new Error("powershell.run requires { command: string }.");
        }
        const command = body.command.trim();
        if (dangerousPowerShell(command)) {
          throw new Error("Command is blocked by the local destructive-command guard.");
        }
        const timeoutMs = normalizeLimit(
          body.timeoutMs,
          options.config.commandTimeoutMs,
          options.config.commandTimeoutMs,
        );
        return await runPowerShell(command, timeoutMs);
      },
    },
  ];
}
