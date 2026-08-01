import { getEnv } from "./process/env.ts";

const DEFAULT_TIME_SCALE = 1;
const TIME_SCALE_ENV = "VF_TEST_TIME_SCALE";

function readTimeScale(): number {
  const raw = getEnv(TIME_SCALE_ENV);
  if (!raw) return DEFAULT_TIME_SCALE;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIME_SCALE;

  return parsed;
}

/** Return the configured cross-runtime time scale. */
export function getTimeScale(): number {
  return readTimeScale();
}

/** Scale a duration for cross-runtime timers. */
export function scaleDuration(ms: number, minMs = 1): number {
  return Math.max(minMs, Math.round(ms * readTimeScale()));
}
