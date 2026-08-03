import type { RateLimitEntry } from "./types.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";

/** Maximum UTF-16 code units accepted by a rate-limit key. */
export const MAX_RATE_LIMIT_KEY_LENGTH = 1_024;

export function requireRateLimitKey(
  value: unknown,
  name = "Rate limit key",
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  if (value.trim().length === 0 || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${name} must contain visible text without control characters`);
  }
  if (value.length > MAX_RATE_LIMIT_KEY_LENGTH) {
    throw new RangeError(
      `${name} must contain at most ${MAX_RATE_LIMIT_KEY_LENGTH} characters`,
    );
  }
  return value;
}

export function requireRateLimitWindowMs(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Rate limit windowMs must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return value;
}

export function requireRateLimitEntry(value: unknown): RateLimitEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Rate limit store must return an entry object");
  }

  const { count, resetAt } = value as Partial<RateLimitEntry>;
  if (!Number.isSafeInteger(count) || (count ?? 0) < 1) {
    throw new TypeError(
      "Rate limit store entry count must be a positive safe integer",
    );
  }
  if (!Number.isSafeInteger(resetAt) || (resetAt ?? 0) < 1) {
    throw new TypeError(
      "Rate limit store entry resetAt must be a positive safe integer",
    );
  }

  return { count: count!, resetAt: resetAt! };
}
