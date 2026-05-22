import type { JsonlEventStore } from "../events/event-store.js";
import type { JarvisConfig, JarvisEvent } from "../shared/types.js";
import type { ReflectionStore, RecordReflectionInput } from "./reflection-store.js";

export type ReflectionLoopStatus = {
  running: boolean;
  tickCount: number;
  recordedCount: number;
  lastTickAt?: number;
  lastError?: string;
};

export type ReflectionLoopDependencies = {
  config: JarvisConfig["reflection"];
  eventStore: JsonlEventStore;
  reflectionStore: ReflectionStore;
  emitEvent: <TPayload>(
    event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">,
  ) => Promise<void>;
};

function payloadRecord(event: JarvisEvent<unknown>): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}

function textField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function reflectionFromEvent(
  event: JarvisEvent<unknown>,
  latencyWarningMs: number,
): RecordReflectionInput | undefined {
  const payload = payloadRecord(event);
  const syntheticFullCheck =
    Object.values(payload)
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map(String)
      .join(" ")
      .toLowerCase()
      .includes("full check") ||
    Object.values(payload)
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map(String)
      .join(" ")
      .toLowerCase()
      .includes("full-check");
  if (syntheticFullCheck) {
    return undefined;
  }
  if (isExpectedBoundaryFailure(event)) {
    return undefined;
  }
  if (event.type.includes("failed") || event.type.includes("error")) {
    const error = textField(payload, "error") ?? event.type;
    return {
      kind: "failure",
      title: `Failure observed: ${event.type}`,
      summary: error,
      tags: ["runtime", "failure", event.source],
      sourceEventId: event.id,
      confidence: 0.82,
      metadata: { eventType: event.type, source: event.source },
    };
  }

  if (event.type === "action.rejected") {
    const toolName = textField(payload, "toolName") ?? "unknown tool";
    const reason = textField(payload, "reason") ?? "User rejected an action.";
    return {
      kind: "lesson",
      title: `Action rejected: ${toolName}`,
      summary: `Do not repeat this action without better context: ${reason}`,
      tags: ["action", "user-feedback"],
      sourceEventId: event.id,
      confidence: 0.78,
      metadata: payload,
    };
  }

  if (event.type === "chat.assistant_message") {
    const latencyMs = typeof payload.latencyMs === "number" ? payload.latencyMs : undefined;
    if (latencyMs && latencyMs > latencyWarningMs) {
      return {
        kind: "policy_suggestion",
        title: "Chat response exceeded latency target",
        summary: `Assistant response took ${latencyMs}ms; prefer fast mode unless the user asks for deep reasoning.`,
        tags: ["latency", "model-router"],
        sourceEventId: event.id,
        confidence: 0.72,
        metadata: payload,
      };
    }
  }

  return undefined;
}

function payloadText(event: JarvisEvent<unknown>): string {
  const payload = payloadRecord(event);
  return Object.values(payload)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(String)
    .join(" ");
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

export class ReflectionLoop {
  private timer: NodeJS.Timeout | undefined;
  private statusValue: ReflectionLoopStatus = {
    running: false,
    tickCount: 0,
    recordedCount: 0,
  };

  constructor(private readonly deps: ReflectionLoopDependencies) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.statusValue.running = true;
    const tickMs = Math.max(1000, this.deps.config.tickMs);
    this.timer = setInterval(() => {
      void this.tick();
    }, tickMs);
    this.timer.unref();
    if (this.statusValue.tickCount === 0) {
      void this.tick();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.statusValue.running = false;
  }

  status(): ReflectionLoopStatus {
    return { ...this.statusValue };
  }

  async tick(): Promise<number> {
    try {
      const events = await this.deps.eventStore.recent(80);
      let recorded = 0;
      for (const event of events) {
        const reflection = reflectionFromEvent(event, this.deps.config.chatLatencyWarningMs);
        if (!reflection) {
          continue;
        }
        const result = await this.deps.reflectionStore.record(reflection);
        if (result.created) {
          recorded += 1;
          await this.deps.emitEvent({
            type: "reflection.recorded",
            source: "reflection-loop",
            importance: result.reflection.kind === "failure" ? 0.7 : 0.45,
            payload: result.reflection,
          });
        }
      }
      this.statusValue = {
        running: this.statusValue.running,
        tickCount: this.statusValue.tickCount + 1,
        recordedCount: this.statusValue.recordedCount + recorded,
        lastTickAt: Date.now(),
      };
      return recorded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.statusValue = {
        ...this.statusValue,
        running: this.statusValue.running,
        tickCount: this.statusValue.tickCount + 1,
        lastTickAt: Date.now(),
        lastError: message,
      };
      await this.deps.emitEvent({
        type: "reflection.tick_failed",
        source: "reflection-loop",
        importance: 0.7,
        payload: { error: message },
      });
      return 0;
    }
  }
}
