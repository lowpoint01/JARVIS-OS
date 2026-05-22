import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLocalRuntimeTools } from "./local-tools.js";

async function withTempProject<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-tools-"));
  try {
    return await fn(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function tools(rootDir: string) {
  return buildLocalRuntimeTools({
    rootDir,
    config: {
      allowedRoots: ["."],
      excludedSegments: ["data"],
      maxReadBytes: 5000,
      searchLimit: 20,
      commandTimeoutMs: 1000,
    },
  });
}

describe("buildLocalRuntimeTools", () => {
  it("searches and reads only safe project files", async () => {
    await withTempProject(async (rootDir) => {
      await fs.writeFile(path.join(rootDir, "notes.md"), "hello JARVIS", "utf8");
      const localTools = tools(rootDir);
      const search = localTools.find((tool) => tool.name === "files.search");
      const read = localTools.find((tool) => tool.name === "files.read");

      const matches = await search?.handler({ query: "notes" }, {
        requestId: "test",
        emitEvent: async () => {},
      });
      const content = await read?.handler({ path: "notes.md" }, {
        requestId: "test",
        emitEvent: async () => {},
      });

      expect(matches).toEqual([{ path: "notes.md", bytes: 0 }]);
      expect(content).toMatchObject({ path: "notes.md", binary: false, content: "hello JARVIS" });
    });
  });

  it("blocks sensitive file reads and outside paths", async () => {
    await withTempProject(async (rootDir) => {
      await fs.writeFile(path.join(rootDir, "secrets.local.yaml"), "token: nope", "utf8");
      const read = tools(rootDir).find((tool) => tool.name === "files.read");

      await expect(
        read?.handler({ path: "secrets.local.yaml" }, {
          requestId: "test",
          emitEvent: async () => {},
        }),
      ).rejects.toThrow(/sensitive/);
      await expect(
        read?.handler({ path: path.dirname(rootDir) }, {
          requestId: "test",
          emitEvent: async () => {},
        }),
      ).rejects.toThrow(/outside/);
    });
  });

  it("marks PowerShell execution as a confirmed high-risk tool", () => {
    const run = tools(process.cwd()).find((tool) => tool.name === "powershell.run");

    expect(run?.riskLevel).toBe("L3");
    expect(run?.requiresConfirmation).toBe(true);
  });
});
