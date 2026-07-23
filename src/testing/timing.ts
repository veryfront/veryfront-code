import { getEnv } from "#veryfront/platform/compat/process.ts";

const DEFAULT_SCALE = 1;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number`);
  }
}

function readScale(): number {
  const raw = getEnv("VF_TEST_TIME_SCALE");
  if (!raw) return DEFAULT_SCALE;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SCALE;

  return parsed;
}

/** Return test time scale. */
export function getTestTimeScale(): number {
  return readScale();
}

/** Scale a duration for the current test runtime. */
export function scaleMs(ms: number, minMs = 1): number {
  assertFiniteNonNegative(ms, "Duration");
  assertFiniteNonNegative(minMs, "Minimum duration");

  const scaled = Math.max(minMs, Math.round(ms * readScale()));
  if (!Number.isFinite(scaled) || scaled > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`Scaled duration must not exceed ${MAX_TIMER_DELAY_MS}ms`);
  }
  return scaled;
}

/** Wait for a test-scaled duration. */
export function testDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}
