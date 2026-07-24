import { MAX_TIMER_DELAY_MS } from "./constants/limits.ts";

export { MAX_TIMER_DELAY_MS } from "./constants/limits.ts";

/**
 * Normalize a requested delay to the portable JavaScript timer domain.
 *
 * Fractional milliseconds round up so a timeout never fires earlier than the
 * caller requested. Negative, non-finite, and overflowing values are rejected
 * instead of being silently clamped by the runtime.
 */
export function normalizeTimerDurationMs(
  durationMs: number,
  optionName = "Timer duration",
): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError(
      `${optionName} must be finite and between 0 and ${MAX_TIMER_DELAY_MS} milliseconds`,
    );
  }

  const normalized = Math.ceil(durationMs);
  if (normalized > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      `${optionName} must be finite and between 0 and ${MAX_TIMER_DELAY_MS} milliseconds`,
    );
  }
  return normalized === 0 ? 0 : normalized;
}
