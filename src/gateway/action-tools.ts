import type { ActionStatus, ActionStore } from "../actions/action-store.js";
import type { RiskLevel, ToolDefinition } from "../shared/types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStatus(value: unknown): ActionStatus | undefined {
  return typeof value === "string" &&
    ["pending", "approved", "executed", "rejected", "failed"].includes(value)
    ? (value as ActionStatus)
    : undefined;
}

function asRiskLevel(value: unknown): RiskLevel {
  return typeof value === "string" && ["L0", "L1", "L2", "L3", "L4"].includes(value)
    ? (value as RiskLevel)
    : "L2";
}

export function buildActionTools(actionStore: ActionStore): ToolDefinition[] {
  return [
    {
      name: "actions.propose",
      description: "Create a pending action proposal without executing it.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input, context) => {
        const body = asRecord(input);
        if (typeof body?.toolName !== "string") {
          throw new Error("actions.propose requires { toolName: string }.");
        }
        const action = await actionStore.createPending({
          toolName: body.toolName,
          input: body.input,
          riskLevel: asRiskLevel(body.riskLevel),
          reason:
            typeof body.reason === "string"
              ? body.reason
              : "JARVIS proposed an action that needs approval.",
        });
        await context.emitEvent({
          type: "action.confirmation_required",
          source: "action-queue",
          importance: 0.75,
          payload: {
            actionId: action.id,
            toolName: action.toolName,
            riskLevel: action.riskLevel,
            reason: action.reason,
          },
        });
        return action;
      },
    },
    {
      name: "actions.pending",
      description: "List pending actions that require user approval before execution.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const limit = typeof body?.limit === "number" ? body.limit : 50;
        return actionStore.list("pending", limit);
      },
    },
    {
      name: "actions.list",
      description: "List recent actions by status.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const limit = typeof body?.limit === "number" ? body.limit : 50;
        return actionStore.list(asStatus(body?.status), limit);
      },
    },
  ];
}
