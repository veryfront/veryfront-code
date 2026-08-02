import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_TIMER_DELAY_MS, normalizeTimerDurationMs } from "./timer.ts";

describe("utils/timer", () => {
  it("rounds fractional durations up so timers never fire earlier than requested", () => {
    assertEquals(normalizeTimerDurationMs(0), 0);
    assertEquals(normalizeTimerDurationMs(0.01), 1);
    assertEquals(normalizeTimerDurationMs(1.5), 2);
    assertEquals(normalizeTimerDurationMs(MAX_TIMER_DELAY_MS - 0.5), MAX_TIMER_DELAY_MS);
    assertEquals(normalizeTimerDurationMs(MAX_TIMER_DELAY_MS), MAX_TIMER_DELAY_MS);
  });

  it("rejects durations outside the portable JavaScript timer domain", () => {
    for (
      const durationMs of [
        -0.01,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 0.5,
      ]
    ) {
      assertThrows(() => normalizeTimerDurationMs(durationMs), RangeError);
    }
  });
});
