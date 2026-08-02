/** Largest exact integer accepted by observability counters and durations. */
const MAX_SAFE_METRIC_VALUE = Number.MAX_SAFE_INTEGER;

/** Normalize a counter input to a finite, non-negative safe integer. */
export function nonNegativeSafeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_SAFE_METRIC_VALUE, Math.floor(value));
}

/** Normalize a measurement to a finite, non-negative, exactly bounded value. */
export function nonNegativeFiniteMeasure(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_SAFE_METRIC_VALUE, value);
}

/** Add counter values without crossing JavaScript's exact-integer boundary. */
export function saturatingAdd(current: number, increment = 1): number {
  const normalizedCurrent = nonNegativeSafeInteger(current);
  const normalizedIncrement = nonNegativeSafeInteger(increment);
  if (normalizedIncrement >= MAX_SAFE_METRIC_VALUE - normalizedCurrent) {
    return MAX_SAFE_METRIC_VALUE;
  }
  return normalizedCurrent + normalizedIncrement;
}

/** Add measurements without producing Infinity or an unsafe finite result. */
export function saturatingAddMeasure(current: number, increment: number): number {
  const normalizedCurrent = nonNegativeFiniteMeasure(current);
  const normalizedIncrement = nonNegativeFiniteMeasure(increment);
  if (normalizedIncrement >= MAX_SAFE_METRIC_VALUE - normalizedCurrent) {
    return MAX_SAFE_METRIC_VALUE;
  }
  return normalizedCurrent + normalizedIncrement;
}
