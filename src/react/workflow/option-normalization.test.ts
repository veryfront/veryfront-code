import { assertEquals, assertThrows } from "@std/assert";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { MAX_WORKFLOW_RUN_LIST_LIMIT } from "#veryfront/workflow/limits.ts";
import {
  boundedReconnectDelayMs,
  normalizeActiveTimerDelayMs,
  normalizeHistoryLimit,
  normalizePageSize,
  normalizePingIntervalMs,
  normalizeReconnectAttempts,
} from "./option-normalization.ts";

Deno.test("workflow hook numeric options admit only portable integer domains", () => {
  assertEquals(normalizeActiveTimerDelayMs(1, "delay"), 1);
  assertEquals(normalizeActiveTimerDelayMs(MAX_TIMER_DELAY_MS, "delay"), MAX_TIMER_DELAY_MS);
  assertEquals(normalizePingIntervalMs(0), 0);
  assertEquals(normalizeReconnectAttempts(0), 0);
  assertEquals(normalizeReconnectAttempts(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assertEquals(normalizePageSize(MAX_WORKFLOW_RUN_LIST_LIMIT), MAX_WORKFLOW_RUN_LIST_LIMIT);
  assertEquals(normalizeHistoryLimit(10_000, 1_000), 1_000);

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    assertThrows(() => normalizeActiveTimerDelayMs(invalid, "delay"), RangeError);
    assertThrows(() => normalizeReconnectAttempts(invalid), RangeError);
    assertThrows(() => normalizeHistoryLimit(invalid, 1_000), RangeError);
    assertThrows(() => normalizePageSize(invalid), RangeError);
  }
  assertThrows(() => normalizeActiveTimerDelayMs(0, "delay"), RangeError);
  assertThrows(() => normalizeActiveTimerDelayMs(MAX_TIMER_DELAY_MS + 1, "delay"), RangeError);
  assertThrows(() => normalizePingIntervalMs(MAX_TIMER_DELAY_MS + 1), RangeError);
  assertThrows(() => normalizePageSize(0), RangeError);
  assertThrows(() => normalizePageSize(MAX_WORKFLOW_RUN_LIST_LIMIT + 1), RangeError);
});

Deno.test("reconnect backoff never escapes the portable timer domain", () => {
  assertEquals(boundedReconnectDelayMs(1_000, 2), 2_000);
  assertEquals(
    boundedReconnectDelayMs(MAX_TIMER_DELAY_MS, Number.MAX_SAFE_INTEGER),
    MAX_TIMER_DELAY_MS,
  );
});
