import { scaleDuration } from "#veryfront/platform/compat/time-scale.ts";

/** Scale a duration for the current test runtime. */
export function scaleMs(ms: number, minMs = 1): number {
  return scaleDuration(ms, minMs);
}

// no cleanup needed: one-shot
/** Wait for a test-scaled duration. */
export function testDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}
