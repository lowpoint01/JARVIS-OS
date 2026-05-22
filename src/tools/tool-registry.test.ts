import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionStore } from "../actions/action-store.js";
import { SafetyKernel } from "../safety/safety-kernel.js";
import type { JarvisEvent, ToolDefinition } from "../shared/types.js";
import { ToolRegistry } from "./tool-registry.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-tool-registry-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function safety(): SafetyKernel {
  return new SafetyKernel({
    autoAllowLevels: ["L0", "L1"],
    confirmLevels: ["L2", "L3"],
    blockLevels: ["L4"],
  });
}

describe("ToolRegistry confirmation actions", () => {
  it("queues L2 tools and executes them only after approval", async () => {
    const events: Array<Omit<JarvisEvent, "id" | "timestamp">> = [];
    const actionStore = new ActionStore(path.join(tempDir, "actions.jsonl"));
    await actionStore.initialize();
    const registry = new ToolRegistry(
      safety(),
      async (event) => {
        events.push(event);
      },
      actionStore,
    );
    const tool: ToolDefinition = {
      name: "demo.double",
      description: "Demo confirmed tool.",
      riskLevel: "L2",
      requiresConfirmation: false,
      canRollback: true,
      handler: async (input) => {
        const body = input as { value: number };
        return { doubled: body.value * 2 };
      },
    };
    registry.register(tool);

    const queued = await registry.call("demo.double", { value: 21 });
    expect(queued.ok).toBe(false);
    expect(queued.status).toBe("needs_confirmation");
    if (queued.ok) {
      throw new Error("Expected queued action.");
    }
    expect(queued.actionId).toBeTruthy();
    if (!queued.actionId) {
      throw new Error("Expected queued action id.");
    }
    expect(actionStore.count("pending")).toBe(1);

    const executed = await registry.approveAndExecute(queued.actionId);
    expect(executed.ok).toBe(true);
    if (!executed.ok) {
      throw new Error(executed.error);
    }
    expect(executed.output).toEqual({ doubled: 42 });
    expect(actionStore.count("executed")).toBe(1);
    expect(events.some((event) => event.type === "action.confirmation_required")).toBe(true);
  });

  it("rejects pending actions without executing them", async () => {
    const actionStore = new ActionStore(path.join(tempDir, "actions.jsonl"));
    await actionStore.initialize();
    const registry = new ToolRegistry(safety(), async () => {}, actionStore);
    registry.register({
      name: "demo.confirm",
      description: "Demo.",
      riskLevel: "L3",
      requiresConfirmation: false,
      canRollback: true,
      handler: async () => ({ executed: true }),
    });

    const queued = await registry.call("demo.confirm", {});
    if (queued.ok) {
      throw new Error("Expected queued action.");
    }
    const rejected = await registry.rejectAction(queued.actionId ?? "", "not now");

    expect(rejected.ok).toBe(true);
    expect(actionStore.count("rejected")).toBe(1);
  });
});
