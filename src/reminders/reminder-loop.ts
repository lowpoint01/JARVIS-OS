import type { JsonlEventStore } from "../events/event-store.js";
import type { JarvisEvent } from "../shared/types.js";
import type { ReminderStore } from "./reminder-store.js";

export type ReminderLoopStatus = {
  running: boolean;
  tickCount: number;
  deliveredCount: number;
  lastTickAt?: number;
  lastError?: string;
};

export type ReminderLoopDependencies = {
  reminderStore: ReminderStore;
  eventStore: JsonlEventStore;
  emitEvent: <TPayload>(
    event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">,
  ) => Promise<void>;
  intervalMs?: number;
};

export class ReminderLoop {
  private timer: NodeJS.Timeout | undefined;
  private statusValue: ReminderLoopStatus = {
    running: false,
    tickCount: 0,
    deliveredCount: 0,
  };

  constructor(private readonly deps: ReminderLoopDependencies) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.statusValue.running = true;
    const intervalMs = Math.max(1000, this.deps.intervalMs ?? 5000);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
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

  status(): ReminderLoopStatus {
    return { ...this.statusValue };
  }

  async tick(now = Date.now()): Promise<number> {
    try {
      const due = this.deps.reminderStore.due(now);
      for (const reminder of due) {
        await this.deps.emitEvent({
          type: "reminder.due",
          source: "reminder-loop",
          importance: 0.7,
          payload: reminder,
        });
        await this.deps.reminderStore.markDelivered(reminder.id);
      }
      this.statusValue = {
        running: this.statusValue.running,
        tickCount: this.statusValue.tickCount + 1,
        deliveredCount: this.statusValue.deliveredCount + due.length,
        lastTickAt: Date.now(),
      };
      return due.length;
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
        type: "reminder.tick_failed",
        source: "reminder-loop",
        importance: 0.7,
        payload: { error: message },
      });
      return 0;
    }
  }
}
