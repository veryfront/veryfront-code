import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { MAX_WORKFLOW_RUN_LIST_LIMIT } from "#veryfront/workflow/limits.ts";

function requireSafeInteger(value: number, optionName: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${optionName} must be a finite safe integer`);
  }
  return value;
}

/** Admit an active interval/timeout in the portable JavaScript timer domain. */
export function normalizeActiveTimerDelayMs(value: number, optionName: string): number {
  const normalized = requireSafeInteger(value, optionName);
  if (normalized < 1 || normalized > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`${optionName} must be between 1 and ${MAX_TIMER_DELAY_MS}`);
  }
  return normalized;
}

/** Ping uses zero as its documented disabled sentinel; active values remain bounded. */
export function normalizePingIntervalMs(value: number): number {
  return value === 0 ? 0 : normalizeActiveTimerDelayMs(value, "pingInterval");
}

/** Reconnect counts are finite, safe, and non-negative. */
export function normalizeReconnectAttempts(value: number): number {
  const normalized = requireSafeInteger(value, "maxReconnectAttempts");
  if (normalized < 0) throw new RangeError("maxReconnectAttempts must be non-negative");
  return normalized;
}

/** History is capped after validating the caller supplied an exact count. */
export function normalizeHistoryLimit(value: number, maximum: number): number {
  const normalized = requireSafeInteger(value, "maxEventHistory");
  if (normalized < 0) throw new RangeError("maxEventHistory must be non-negative");
  return Math.min(normalized, maximum);
}

/** Workflow list requests share the backend/schema page-size ceiling. */
export function normalizePageSize(value: number): number {
  const normalized = requireSafeInteger(value, "pageSize");
  if (normalized < 1 || normalized > MAX_WORKFLOW_RUN_LIST_LIMIT) {
    throw new RangeError(`pageSize must be between 1 and ${MAX_WORKFLOW_RUN_LIST_LIMIT}`);
  }
  return normalized;
}

/** Linear retry backoff is saturated before reaching setTimeout. */
export function boundedReconnectDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.min(MAX_TIMER_DELAY_MS, baseDelayMs * Math.max(1, attempt));
}
