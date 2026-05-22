import type { NotificationLevel } from "../notifications/notification-store.js";
import type { JarvisEvent } from "../shared/types.js";
import type { InitiativeDecision } from "./initiative-score.js";

export type ProactivePlanKind = "observe" | "remember" | "prepare" | "notify" | "confirm";

export type ProactivePlan = {
  kind: ProactivePlanKind;
  targetKey?: string;
  targetEventId?: string;
  title: string;
  summary: string;
  reason: string;
  importance: number;
  notification?: {
    level: NotificationLevel;
    title: string;
    message: string;
    dedupeKey: string;
  };
};

type PlanNotification = NonNullable<ProactivePlan["notification"]>;

function payloadRecord(event: JarvisEvent<unknown>): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}

function payloadText(event: JarvisEvent<unknown>): string {
  const payload = payloadRecord(event);
  return Object.values(payload)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(String)
    .join(" ");
}

function truncate(value: string, max = 220): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function textField(event: JarvisEvent<unknown>, key: string): string | undefined {
  const value = payloadRecord(event)[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(event: JarvisEvent<unknown>, key: string): number | undefined {
  const value = payloadRecord(event)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isSyntheticFullCheckEvent(event: JarvisEvent<unknown>): boolean {
  const text = [event.type, event.source, payloadText(event)].join(" ").toLowerCase();
  return text.includes("full check") || text.includes("full-check");
}

function isInternalNoiseEvent(event: JarvisEvent<unknown>): boolean {
  if (isSyntheticFullCheckEvent(event)) {
    return true;
  }
  if (isExpectedBoundaryFailure(event)) {
    return true;
  }
  if (
    event.type === "initiative.tick" ||
    event.type === "initiative.memory_stored" ||
    event.type === "initiative.background_prepared" ||
    event.type === "initiative.proactive_notification" ||
    event.type === "notification.created" ||
    event.type === "reflection.recorded" ||
    event.type === "perception.system_sample" ||
    event.type === "tool.call.started" ||
    event.type === "tool.call.completed" ||
    event.type === "memory.auto_intake"
  ) {
    return true;
  }
  if (event.type === "chat.assistant_message") {
    return (numberField(event, "latencyMs") ?? 0) <= 2000;
  }
  return false;
}

function isAlreadyDirectlyNotified(event: JarvisEvent<unknown>): boolean {
  return (
    event.type === "action.confirmation_required" ||
    event.type === "model.upstream_failed" ||
    event.type === "reminder.due" ||
    event.type === "perception.resource_warning" ||
    event.type === "gateway.request_failed" ||
    event.type === "initiative.tick_failed" ||
    event.type === "perception.tick_failed"
  );
}

function isFailureEvent(event: JarvisEvent<unknown>): boolean {
  return event.type.includes("failed") || event.type.includes("error");
}

function isExpectedBoundaryFailure(event: JarvisEvent<unknown>): boolean {
  if (event.type !== "tool.call.failed") {
    return false;
  }
  const text = [event.type, event.source, payloadText(event)].join(" ").toLowerCase();
  return [
    "too large to read safely",
    "requires {",
    "requires non-empty",
    "outside configured",
    "inside an excluded segment",
    "refusing to read",
    "not pending",
    "not found",
  ].some((pattern) => text.includes(pattern));
}

function isSlowChatEvent(event: JarvisEvent<unknown>): boolean {
  return event.type === "chat.assistant_message" && (numberField(event, "latencyMs") ?? 0) > 2000;
}

export function actionableInitiativeEvents(
  events: Array<JarvisEvent<unknown>>,
): Array<JarvisEvent<unknown>> {
  return events.filter((event) => !isInternalNoiseEvent(event));
}

function latestActionableEvent(events: Array<JarvisEvent<unknown>>): JarvisEvent<unknown> | undefined {
  return actionableInitiativeEvents(events)
    .slice()
    .sort((left, right) => right.timestamp - left.timestamp)
    .at(0);
}

function summarizeEvent(event: JarvisEvent<unknown>): string {
  const error = textField(event, "error");
  if (error) {
    return truncate(error);
  }
  const message = textField(event, "message") ?? textField(event, "content");
  if (message) {
    return truncate(message);
  }
  const latencyMs = numberField(event, "latencyMs");
  if (latencyMs !== undefined) {
    return `Latency ${latencyMs}ms.`;
  }
  return truncate(payloadText(event) || `${event.type} from ${event.source}`);
}

function targetKeyFor(event: JarvisEvent<unknown>, kind: ProactivePlanKind): string {
  if (isFailureEvent(event)) {
    return `initiative:${kind}:${event.type}:${event.source}`;
  }
  if (isSlowChatEvent(event)) {
    return `initiative:${kind}:chat.latency`;
  }
  return `initiative:${kind}:${event.id}`;
}

function notificationFor(event: JarvisEvent<unknown>, summary: string): PlanNotification {
  if (isSlowChatEvent(event)) {
    const latencyMs = numberField(event, "latencyMs");
    return {
      level: "suggestion",
      title: "Chat latency watch",
      message: `The last assistant response took ${latencyMs}ms. Routine chat should stay in fast mode.`,
      dedupeKey: "initiative:chat.latency",
    };
  }
  return {
    level: event.importance >= 0.85 ? "critical" : "warning",
    title: isFailureEvent(event) ? "Runtime attention needed" : "JARVIS proactive attention",
    message: `${event.type} from ${event.source}: ${summary}`,
    dedupeKey: targetKeyFor(event, "notify"),
  };
}

function observe(reason: string): ProactivePlan {
  return {
    kind: "observe",
    title: "Silent observation",
    summary: reason,
    reason,
    importance: 0,
  };
}

export function createProactivePlan(
  events: Array<JarvisEvent<unknown>>,
  decision: InitiativeDecision,
): ProactivePlan {
  const event = latestActionableEvent(events);
  if (!event || decision.level === "A0_SILENT_OBSERVE") {
    return observe(event ? decision.reason : "no actionable events");
  }

  const summary = summarizeEvent(event);
  const targetEventId = event.id;
  const importance = Math.max(event.importance, decision.score);

  if (isAlreadyDirectlyNotified(event)) {
    return {
      kind: "prepare",
      targetKey: targetKeyFor(event, "prepare"),
      targetEventId,
      title: "Direct notification already handled",
      summary,
      reason: "event-specific notification bridge already owns user interruption",
      importance,
    };
  }

  if (decision.level === "A1_AUTO_MEMORY") {
    return {
      kind: "remember",
      targetKey: targetKeyFor(event, "remember"),
      targetEventId,
      title: "Remember useful observation",
      summary: `JARVIS observed ${event.type} from ${event.source}: ${summary}`,
      reason: decision.reason,
      importance,
    };
  }

  if (decision.level === "A2_BACKGROUND_PREPARE") {
    return {
      kind: isFailureEvent(event) || isSlowChatEvent(event) ? "notify" : "prepare",
      targetKey: targetKeyFor(event, isFailureEvent(event) || isSlowChatEvent(event) ? "notify" : "prepare"),
      targetEventId,
      title: isFailureEvent(event) ? "Prepare and notify about recoverable issue" : "Prepare context",
      summary,
      reason: decision.reason,
      importance,
      notification:
        isFailureEvent(event) || isSlowChatEvent(event) ? notificationFor(event, summary) : undefined,
    };
  }

  if (decision.level === "A5_CONFIRM_EXECUTE") {
    const notification = notificationFor(event, summary);
    return {
      kind: "confirm",
      targetKey: targetKeyFor(event, "confirm"),
      targetEventId,
      title: "Confirmation-worthy proactive action",
      summary,
      reason: decision.reason,
      importance,
      notification: {
        ...notification,
        title: "JARVIS needs confirmation",
      },
    };
  }

  return {
    kind: "notify",
    targetKey: targetKeyFor(event, "notify"),
    targetEventId,
    title: "Proactive notification",
    summary,
    reason: decision.reason,
    importance,
    notification: notificationFor(event, summary),
  };
}
