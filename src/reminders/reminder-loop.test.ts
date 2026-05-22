import { describe, expect, it } from "vitest";
import { ReminderLoop } from "./reminder-loop.js";
import type { ReminderStore } from "./reminder-store.js";
import type { JsonlEventStore } from "../events/event-store.js";

describe("ReminderLoop", () => {
  it("emits due reminders and marks them delivered", async () => {
    const emitted: string[] = [];
    const store = {
      due: () => [
        {
          id: "rmd_1",
          title: "Test",
          message: "Due",
          dueAt: 1000,
          status: "scheduled",
          createdAt: 1,
          updatedAt: 1,
          metadata: {},
        },
      ],
      markDelivered: async () => undefined,
    } as unknown as ReminderStore;
    const loop = new ReminderLoop({
      reminderStore: store,
      eventStore: {} as JsonlEventStore,
      emitEvent: async (event) => {
        emitted.push(event.type);
      },
    });

    const delivered = await loop.tick(1000);

    expect(delivered).toBe(1);
    expect(emitted).toEqual(["reminder.due"]);
  });
});
