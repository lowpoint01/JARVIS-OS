import type { NotificationRecord, NotificationStore } from "./notification-store.js";
import type { JarvisEvent } from "../shared/types.js";

function payloadRecord(event: JarvisEvent<unknown>): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}

export async function createNotificationForEvent(
  store: NotificationStore,
  event: JarvisEvent<unknown>,
): Promise<NotificationRecord | undefined> {
  const payload = payloadRecord(event);
  if (event.type === "initiative.proactive_notification") {
    const title = typeof payload.title === "string" ? payload.title : "JARVIS proactive attention";
    const message =
      typeof payload.message === "string" ? payload.message : "JARVIS has a proactive update.";
    const dedupeKey =
      typeof payload.dedupeKey === "string" ? payload.dedupeKey : `initiative:${event.id}`;
    const level =
      payload.level === "info" ||
      payload.level === "suggestion" ||
      payload.level === "warning" ||
      payload.level === "critical"
        ? payload.level
        : "suggestion";
    return await store.create({
      level,
      title,
      message,
      source: "initiative-loop",
      dedupeKey,
      metadata: payload,
    });
  }

  if (event.type === "action.confirmation_required") {
    const actionId = typeof payload.actionId === "string" ? payload.actionId : undefined;
    const toolName = typeof payload.toolName === "string" ? payload.toolName : "unknown tool";
    return await store.create({
      level: "warning",
      title: "Action needs approval",
      message: `${toolName} is waiting for your approval before JARVIS can execute it.`,
      source: "action-queue",
      actionId,
      dedupeKey: actionId ? `action:${actionId}` : `action:${event.id}`,
      metadata: payload,
    });
  }

  if (event.type === "model.upstream_failed") {
    const statusCode = typeof payload.statusCode === "number" ? payload.statusCode : "unknown";
    const error = typeof payload.error === "string" ? payload.error : "model request failed";
    return await store.create({
      level: "critical",
      title: "Model request failed",
      message: `Kimi request failed with status ${statusCode}: ${error}`,
      source: "model-router",
      dedupeKey: "model.upstream_failed",
      metadata: payload,
    });
  }

  if (event.type === "reminder.due") {
    const id = typeof payload.id === "string" ? payload.id : event.id;
    const title = typeof payload.title === "string" ? payload.title : "Reminder due";
    const message = typeof payload.message === "string" ? payload.message : "A reminder is due.";
    return await store.create({
      level: "suggestion",
      title,
      message,
      source: "reminder-loop",
      dedupeKey: `reminder:${id}`,
      metadata: payload,
    });
  }

  if (event.type === "perception.resource_warning") {
    const freeRatio = typeof payload.freeRatio === "number" ? payload.freeRatio : undefined;
    const percent = freeRatio === undefined ? "unknown" : `${Math.round(freeRatio * 100)}%`;
    return await store.create({
      level: "warning",
      title: "System resource warning",
      message: `Available memory is low (${percent} free).`,
      source: "perception-loop",
      dedupeKey: "perception.resource_warning.low_memory",
      metadata: payload,
    });
  }

  if (
    event.type === "gateway.request_failed" ||
    event.type === "initiative.tick_failed" ||
    event.type === "perception.tick_failed"
  ) {
    const error = typeof payload.error === "string" ? payload.error : event.type;
    return await store.create({
      level: "warning",
      title: "JARVIS runtime warning",
      message: error,
      source: event.source,
      dedupeKey: event.type,
      metadata: payload,
    });
  }

  return undefined;
}
