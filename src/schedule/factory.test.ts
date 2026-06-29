import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { schedule } from "./factory.ts";
import { isScheduleDefinition } from "./types.ts";

describe("schedule/factory", () => {
  it("normalizes cron into schedule", () => {
    const definition = schedule({
      id: "daily-triage",
      name: "Daily triage",
      cron: "0 8 * * 1-5",
      timezone: "Europe/Stockholm",
      target: { kind: "workflow", id: "escalate-ticket" },
      input: { queue: "priority" },
      concurrencyPolicy: "Forbid",
    });

    assertEquals(definition, {
      id: "daily-triage",
      name: "Daily triage",
      schedule: "0 8 * * 1-5",
      timezone: "Europe/Stockholm",
      target: { kind: "workflow", id: "escalate-ticket" },
      input: { queue: "priority" },
      concurrencyPolicy: "Forbid",
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("rejects invalid ids and targets", () => {
    assertThrows(
      () =>
        schedule({
          id: "Daily Triage",
          cron: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
        }),
      Error,
      "Schedule id must start",
    );

    assertThrows(
      () =>
        schedule({
          id: "daily-triage",
          cron: "0 8 * * 1-5",
          target: { kind: "queue", id: "priority" } as never,
        }),
      Error,
      "Schedule target",
    );
  });

  it("rejects non-serializable input", () => {
    assertThrows(
      () =>
        schedule({
          id: "daily-triage",
          cron: "0 8 * * 1-5",
          target: { kind: "task", id: "sync-helpdesk" },
          input: { now: new Date() },
        }),
      Error,
      "Schedule input.now must be JSON-serializable.",
    );
  });
});
