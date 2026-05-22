import type {
  JarvisEvent,
  ToolCallResult,
  ToolContext,
  ToolDefinition,
} from "../shared/types.js";
import type { ActionStore } from "../actions/action-store.js";
import { createId } from "../shared/id.js";
import { SafetyKernel } from "../safety/safety-kernel.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly safety: SafetyKernel,
    private readonly emitEvent: <TPayload>(
      event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">,
    ) => Promise<void>,
    private readonly actionStore?: ActionStore,
  ) {}

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  list(): Array<Omit<ToolDefinition, "handler">> {
    return Array.from(this.tools.values()).map(({ handler: _handler, ...definition }) => definition);
  }

  async call(name: string, input: unknown): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        status: "not_found",
        error: `Tool not found: ${name}`,
      };
    }

    const safety = this.safety.evaluate(tool);
    if (safety.status === "block") {
      return this.safety.blockedResult(tool);
    }
    if (safety.status === "confirm") {
      const result = this.safety.confirmationResult(tool);
      if (result.ok) {
        throw new Error("Unexpected confirmation result state.");
      }
      if (!this.actionStore) {
        return result;
      }
      const action = await this.actionStore.createPending({
        toolName: tool.name,
        input,
        riskLevel: tool.riskLevel,
        reason: result.error,
      });
      await this.emitEvent({
        type: "action.confirmation_required",
        source: "tool-runtime",
        importance: 0.75,
        payload: {
          actionId: action.id,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          reason: result.error,
        },
      });
      return {
        ...result,
        actionId: action.id,
      };
    }

    return await this.executeTool(tool, input, createId("tool"));
  }

  async approveAndExecute(actionId: string): Promise<ToolCallResult> {
    if (!this.actionStore) {
      return {
        ok: false,
        status: "failed",
        error: "Action approval is not configured.",
      };
    }
    const action = this.actionStore.get(actionId);
    if (!action) {
      return {
        ok: false,
        status: "not_found",
        error: `Action not found: ${actionId}`,
      };
    }
    const tool = this.tools.get(action.toolName);
    if (!tool) {
      return {
        ok: false,
        status: "not_found",
        error: `Tool not found for action ${actionId}: ${action.toolName}`,
      };
    }
    const safety = this.safety.evaluate(tool);
    if (safety.status === "block") {
      return this.safety.blockedResult(tool);
    }

    await this.actionStore.approve(actionId);
    const result = await this.executeTool(tool, action.input, actionId);
    if (result.ok) {
      await this.actionStore.markExecuted(actionId, result.output);
    } else {
      await this.actionStore.markFailed(actionId, result.error);
    }
    return result;
  }

  async rejectAction(actionId: string, reason?: string): Promise<ToolCallResult> {
    if (!this.actionStore) {
      return {
        ok: false,
        status: "failed",
        error: "Action approval is not configured.",
      };
    }
    try {
      const action = await this.actionStore.reject(actionId, reason);
      await this.emitEvent({
        type: "action.rejected",
        source: "tool-runtime",
        importance: 0.45,
        payload: { actionId: action.id, toolName: action.toolName, reason },
      });
      return {
        ok: true,
        status: "executed",
        riskLevel: "L0",
        output: action,
      };
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeTool(
    tool: ToolDefinition,
    input: unknown,
    requestId: string,
  ): Promise<ToolCallResult> {
    const context: ToolContext = {
      requestId,
      emitEvent: this.emitEvent,
    };

    try {
      await this.emitEvent({
        type: "tool.call.started",
        source: "tool-runtime",
        importance: 0.35,
        payload: { requestId, name: tool.name, riskLevel: tool.riskLevel },
      });
      const output = await tool.handler(input, context);
      await this.emitEvent({
        type: "tool.call.completed",
        source: "tool-runtime",
        importance: 0.35,
        payload: { requestId, name: tool.name, riskLevel: tool.riskLevel },
      });
      return {
        ok: true,
        status: "executed",
        riskLevel: tool.riskLevel,
        output,
      };
    } catch (err) {
      await this.emitEvent({
        type: "tool.call.failed",
        source: "tool-runtime",
        importance: 0.65,
        payload: {
          requestId,
          name: tool.name,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return {
        ok: false,
        status: "failed",
        riskLevel: tool.riskLevel,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
