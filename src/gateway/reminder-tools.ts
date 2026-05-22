import type { ReminderStatus, ReminderStore } from "../reminders/reminder-store.js";
import type { ToolDefinition } from "../shared/types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStatus(value: unknown): ReminderStatus | undefined {
  return typeof value === "string" && ["scheduled", "delivered", "cancelled"].includes(value)
    ? (value as ReminderStatus)
    : undefined;
}

function parseDueAt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function buildReminderTools(reminderStore: ReminderStore): ToolDefinition[] {
  return [
    {
      name: "reminders.create",
      description: "Create a scheduled reminder that will become a proactive notification.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.title !== "string" || typeof body.message !== "string") {
          throw new Error("reminders.create requires { title: string, message: string, dueAt }.");
        }
        const dueAt = parseDueAt(body.dueAt);
        if (!dueAt) {
          throw new Error("reminders.create requires a valid dueAt timestamp or ISO date.");
        }
        return await reminderStore.create({
          title: body.title,
          message: body.message,
          dueAt,
          metadata: asRecord(body.metadata),
        });
      },
    },
    {
      name: "reminders.list",
      description: "List reminders by status.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const limit = typeof body?.limit === "number" ? body.limit : 50;
        return reminderStore.list(asStatus(body?.status), limit);
      },
    },
    {
      name: "reminders.cancel",
      description: "Cancel a scheduled reminder.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.reminderId !== "string") {
          throw new Error("reminders.cancel requires { reminderId: string }.");
        }
        return await reminderStore.cancel(body.reminderId);
      },
    },
  ];
}
