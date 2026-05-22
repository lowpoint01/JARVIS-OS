import type { JarvisConfig, JarvisEvent } from "../shared/types.js";
import type { JsonlEventStore } from "../events/event-store.js";
import type { VectorMemoryStore } from "../memory/vector-memory-store.js";
import { decideInitiative, type InitiativeDecision, type InitiativeSignal } from "./initiative-score.js";
import {
  actionableInitiativeEvents,
  createProactivePlan,
  type ProactivePlan,
} from "./proactive-plan.js";

export type ActiveLoopStatus = {
  running: boolean;
  tickCount: number;
  lastTickAt?: number;
  lastDecision?: InitiativeDecision;
  lastPlan?: ProactivePlan;
  executedPlanCount: number;
  handledPlanCount: number;
  lastError?: string;
};

export type ActiveLoopDependencies = {
  config: JarvisConfig;
  eventStore: JsonlEventStore;
  memoryStore: VectorMemoryStore;
  emitEvent: <TPayload>(
    event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">,
  ) => Promise<void>;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function buildInitiativeSignal(events: Array<JarvisEvent<unknown>>): InitiativeSignal {
  const recent = actionableInitiativeEvents(events)
    .slice()
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 25);
  const maxImportance = recent.reduce((max, event) => Math.max(max, event.importance), 0);
  const hasFailure = recent.some(
    (event) => event.type.includes("failed") || event.type.includes("error"),
  );
  const hasSlowChat = recent.some((event) => {
    if (event.type !== "chat.assistant_message") {
      return false;
    }
    const payload = event.payload;
    return Boolean(
      payload &&
        typeof payload === "object" &&
        "latencyMs" in payload &&
        typeof (payload as Record<string, unknown>).latencyMs === "number" &&
        ((payload as Record<string, unknown>).latencyMs as number) > 2000,
    );
  });
  const hasUserMessage = recent.some((event) => event.type === "chat.user_message");
  const hasToolActivity = recent.some((event) => event.type.startsWith("tool."));
  const actionability = hasFailure ? 0.82 : hasSlowChat ? 0.45 : hasUserMessage || hasToolActivity ? 0.35 : 0.15;

  return {
    importance: clamp01(Math.max(maxImportance, hasFailure ? 0.75 : hasSlowChat ? 0.55 : 0)),
    urgency: hasFailure ? 0.9 : hasSlowChat ? 0.55 : hasUserMessage ? 0.3 : 0.08,
    relevance: hasFailure ? 0.85 : hasUserMessage ? 0.75 : hasToolActivity || hasSlowChat ? 0.45 : 0.18,
    actionability,
    successProbability: hasFailure ? 0.7 : 0.75,
    interruptionCost: hasFailure ? 0.2 : hasSlowChat ? 0.45 : 0.55,
    riskCost: hasFailure ? 0.2 : 0.08,
    uncertainty: recent.length === 0 ? 0.65 : hasFailure ? 0.18 : 0.25,
  };
}

export class ActiveLoop {
  private timer: NodeJS.Timeout | undefined;
  private statusValue: ActiveLoopStatus = {
    running: false,
    tickCount: 0,
    executedPlanCount: 0,
    handledPlanCount: 0,
  };
  private readonly handledPlanKeys = new Set<string>();

  constructor(private readonly deps: ActiveLoopDependencies) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.statusValue.running = true;
    const tickMs = Math.max(1000, this.deps.config.initiative.tickMs);
    this.timer = setInterval(() => {
      void this.tick();
    }, tickMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.statusValue.running = false;
  }

  status(): ActiveLoopStatus {
    return { ...this.statusValue };
  }

  async tick(): Promise<InitiativeDecision | undefined> {
    try {
      const events = await this.deps.eventStore.recent(80);
      const signal = buildInitiativeSignal(events);
      const decision = decideInitiative(signal);
      const plan = createProactivePlan(events, decision);
      const executedPlan = await this.executePlan(plan);
      this.statusValue = {
        running: this.statusValue.running,
        tickCount: this.statusValue.tickCount + 1,
        lastTickAt: Date.now(),
        lastDecision: decision,
        lastPlan: plan,
        executedPlanCount: this.statusValue.executedPlanCount + (executedPlan ? 1 : 0),
        handledPlanCount: this.handledPlanKeys.size,
      };

      await this.deps.emitEvent({
        type: "initiative.tick",
        source: "initiative-loop",
        importance: decision.score,
        payload: {
          signal,
          decision,
          plan,
          executedPlan,
          memoryRecords: this.deps.memoryStore.count(),
        },
      });
      return decision;
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
        type: "initiative.tick_failed",
        source: "initiative-loop",
        importance: 0.7,
        payload: { error: message },
      });
      return undefined;
    }
  }

  private async executePlan(plan: ProactivePlan): Promise<boolean> {
    if (plan.kind === "observe" || !plan.targetKey || this.handledPlanKeys.has(plan.targetKey)) {
      return false;
    }
    this.rememberHandledPlan(plan.targetKey);
    try {
      if (plan.kind === "remember") {
        const result = await this.deps.memoryStore.store({
          text: plan.summary,
          kind: "system",
          scope: "initiative",
          tags: ["initiative", "proactive", "observation"],
          importance: plan.importance,
          confidence: 0.78,
          source: "initiative-loop",
          metadata: {
            targetEventId: plan.targetEventId,
            reason: plan.reason,
            planKind: plan.kind,
          },
        });
        await this.deps.emitEvent({
          type: "initiative.memory_stored",
          source: "initiative-loop",
          importance: plan.importance,
          payload: {
            plan,
            created: result.created,
            memoryId: result.memory.id,
          },
        });
        return true;
      }

      if (plan.kind === "prepare") {
        await this.deps.emitEvent({
          type: "initiative.background_prepared",
          source: "initiative-loop",
          importance: plan.importance,
          payload: plan,
        });
        return true;
      }

      if (plan.notification) {
        await this.deps.emitEvent({
          type: "initiative.proactive_notification",
          source: "initiative-loop",
          importance: plan.importance,
          payload: {
            ...plan.notification,
            plan,
          },
        });
        return true;
      }

      return false;
    } catch (err) {
      await this.deps.emitEvent({
        type: "initiative.plan_failed",
        source: "initiative-loop",
        importance: 0.65,
        payload: {
          plan,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return false;
    }
  }

  private rememberHandledPlan(key: string): void {
    this.handledPlanKeys.add(key);
    while (this.handledPlanKeys.size > 200) {
      const first = this.handledPlanKeys.values().next().value as string | undefined;
      if (!first) {
        break;
      }
      this.handledPlanKeys.delete(first);
    }
  }
}
