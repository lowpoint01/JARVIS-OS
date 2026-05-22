import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSelfRepairPlan, runSelfPreflight } from "./self-repair.js";

describe("self repair preflight", () => {
  it("passes when local paths are accessible and writable", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-preflight-"));
    try {
      await fs.mkdir(path.join(rootDir, "configs"), { recursive: true });
      await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
      await fs.writeFile(path.join(rootDir, "configs", "config.yaml"), "runtime: {}\n", "utf8");
      await fs.writeFile(path.join(rootDir, "package.json"), "{}", "utf8");

      const preflight = await runSelfPreflight({
        rootDir,
        diagnose: async () => ({
          ok: true,
          generatedAt: Date.now(),
          summary: "healthy",
          checks: [],
          metrics: {
            uptimeMs: 1,
            memoryRecords: 1,
            conversationSessions: 1,
            pendingActions: 0,
            unreadNotifications: 0,
            scheduledReminders: 0,
            worldEntities: 1,
            worldRelations: 0,
            reflectionRecords: 1,
            reflectionTicks: 1,
            voiceAvailable: true,
            perceptionTicks: 1,
            toolCount: 1,
            recentFailureEvents: 0,
          },
        }),
      });

      expect(preflight.ok).toBe(true);
      expect(buildSelfRepairPlan(preflight).summary).toBe("ready");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
