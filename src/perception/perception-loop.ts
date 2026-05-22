import os from "node:os";
import type { JarvisConfig, JarvisEvent } from "../shared/types.js";

export type SystemResourceSample = {
  timestamp: number;
  platform: NodeJS.Platform;
  arch: string;
  cpuCount: number;
  loadAverage: number[];
  memory: {
    free: number;
    total: number;
    used: number;
    freeRatio: number;
    usedRatio: number;
  };
  process: {
    pid: number;
    uptimeMs: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
};

export type PerceptionWarning = {
  type: "low_memory";
  freeRatio: number;
  threshold: number;
  sample: SystemResourceSample;
};

export type PerceptionLoopStatus = {
  running: boolean;
  tickCount: number;
  lastTickAt?: number;
  lastSample?: SystemResourceSample;
  lastWarning?: PerceptionWarning;
  lastError?: string;
};

export type PerceptionLoopDependencies = {
  config: JarvisConfig["perception"];
  emitEvent: <TPayload>(
    event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">,
  ) => Promise<void>;
  sample?: () => SystemResourceSample;
};

function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function copySample(sample: SystemResourceSample): SystemResourceSample {
  return {
    ...sample,
    loadAverage: [...sample.loadAverage],
    memory: { ...sample.memory },
    process: { ...sample.process },
  };
}

export function collectSystemResourceSample(now = Date.now()): SystemResourceSample {
  const free = os.freemem();
  const total = os.totalmem();
  const used = Math.max(0, total - free);
  const usage = process.memoryUsage();
  return {
    timestamp: now,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg(),
    memory: {
      free,
      total,
      used,
      freeRatio: roundRatio(ratio(free, total)),
      usedRatio: roundRatio(ratio(used, total)),
    },
    process: {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
    },
  };
}

export class PerceptionLoop {
  private timer: NodeJS.Timeout | undefined;
  private statusValue: PerceptionLoopStatus = {
    running: false,
    tickCount: 0,
  };

  constructor(private readonly deps: PerceptionLoopDependencies) {}

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

  status(): PerceptionLoopStatus {
    return {
      ...this.statusValue,
      lastSample: this.statusValue.lastSample
        ? copySample(this.statusValue.lastSample)
        : undefined,
      lastWarning: this.statusValue.lastWarning
        ? {
            ...this.statusValue.lastWarning,
            sample: copySample(this.statusValue.lastWarning.sample),
          }
        : undefined,
    };
  }

  async tick(): Promise<SystemResourceSample | undefined> {
    try {
      const sample = this.deps.sample?.() ?? collectSystemResourceSample();
      const warning =
        sample.memory.freeRatio <= this.deps.config.memoryWarningFreeRatio
          ? {
              type: "low_memory" as const,
              freeRatio: sample.memory.freeRatio,
              threshold: this.deps.config.memoryWarningFreeRatio,
              sample,
            }
          : undefined;

      this.statusValue = {
        running: this.statusValue.running,
        tickCount: this.statusValue.tickCount + 1,
        lastTickAt: Date.now(),
        lastSample: sample,
        lastWarning: warning ?? this.statusValue.lastWarning,
      };

      await this.deps.emitEvent({
        type: "perception.system_sample",
        source: "perception-loop",
        importance: this.deps.config.eventImportance,
        payload: sample,
      });

      if (warning) {
        await this.deps.emitEvent({
          type: "perception.resource_warning",
          source: "perception-loop",
          importance: 0.82,
          payload: warning,
        });
      }

      return sample;
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
        type: "perception.tick_failed",
        source: "perception-loop",
        importance: 0.7,
        payload: { error: message },
      });
      return undefined;
    }
  }
}
