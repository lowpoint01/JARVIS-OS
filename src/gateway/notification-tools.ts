import type {
  NotificationLevel,
  NotificationStatus,
  NotificationStore,
} from "../notifications/notification-store.js";
import type { ToolDefinition } from "../shared/types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStatus(value: unknown): NotificationStatus | undefined {
  return typeof value === "string" && ["unread", "read", "dismissed"].includes(value)
    ? (value as NotificationStatus)
    : undefined;
}

function asLevel(value: unknown): NotificationLevel | undefined {
  return typeof value === "string" && ["info", "suggestion", "warning", "critical"].includes(value)
    ? (value as NotificationLevel)
    : undefined;
}

export function buildNotificationTools(notificationStore: NotificationStore): ToolDefinition[] {
  return [
    {
      name: "notifications.unread",
      description: "List unread proactive notifications.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const limit = typeof body?.limit === "number" ? body.limit : 50;
        return notificationStore.list("unread", limit);
      },
    },
    {
      name: "notifications.list",
      description: "List proactive notifications by status.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        const limit = typeof body?.limit === "number" ? body.limit : 50;
        return notificationStore.list(asStatus(body?.status), limit);
      },
    },
    {
      name: "notifications.read",
      description: "Mark a notification as read.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.notificationId !== "string") {
          throw new Error("notifications.read requires { notificationId: string }.");
        }
        return notificationStore.markRead(body.notificationId);
      },
    },
    {
      name: "notifications.dismiss",
      description: "Dismiss a notification.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.notificationId !== "string") {
          throw new Error("notifications.dismiss requires { notificationId: string }.");
        }
        return notificationStore.dismiss(body.notificationId);
      },
    },
    {
      name: "notifications.create",
      description: "Create a local proactive notification.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.title !== "string" || typeof body.message !== "string") {
          throw new Error("notifications.create requires { title: string, message: string }.");
        }
        return notificationStore.create({
          level: asLevel(body.level) ?? "info",
          title: body.title,
          message: body.message,
          source: typeof body.source === "string" ? body.source : "tool",
          actionId: typeof body.actionId === "string" ? body.actionId : undefined,
          dedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : undefined,
          metadata: asRecord(body.metadata),
        });
      },
    },
  ];
}
