import fs from "node:fs/promises";
import path from "node:path";
import type { JarvisEvent } from "../shared/types.js";
import { createId } from "../shared/id.js";

export class JsonlEventStore {
  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, "");
  }

  async append<TPayload>(
    event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">,
  ): Promise<JarvisEvent<TPayload>> {
    const fullEvent: JarvisEvent<TPayload> = {
      ...event,
      id: createId("evt"),
      timestamp: Date.now(),
    };
    await fs.appendFile(this.filePath, `${JSON.stringify(fullEvent)}\n`, "utf8");
    return fullEvent;
  }

  async recent(limit = 50): Promise<Array<JarvisEvent<unknown>>> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-safeLimit)
        .map((line) => JSON.parse(line) as JarvisEvent<unknown>);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}
