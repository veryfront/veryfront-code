import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfterMs?: number;
}

/** Fixed window strategy - simple counter that resets at fixed intervals */
export function fixedWindowStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<RateLimitResult> {
  return withSpan(
    "security.rateLimit.fixedWindow",
    async () => {
      const count = await store.increment(key, config.windowMs);
      const allowed = count <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - count);
      const resetTime = store instanceof MemoryRateLimitStore
        ? store.getState(key)?.resetTime ?? Date.now() + config.windowMs
        : Date.now() + config.windowMs;

      return { allowed, remaining, resetTime };
    },
    { "rateLimit.maxRequests": config.maxRequests },
  );
}

/** Sliding window strategy - tracks individual timestamps to prevent bursts */
export function slidingWindowStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<RateLimitResult> {
  return withSpan(
    "security.rateLimit.slidingWindow",
    async () => {
      if (!(store instanceof MemoryRateLimitStore)) {
        throw new TypeError("sliding-window requires MemoryRateLimitStore");
      }

      const now = Date.now();
      const windowStart = now - config.windowMs;

      const state = store.getState(key) ?? {
        count: 0,
        resetTime: now + config.windowMs,
        requestTimestamps: [],
      };

      const timestamps = (state.requestTimestamps ?? []).filter(
        (timestamp) => timestamp > windowStart,
      );
      timestamps.push(now);
      if (timestamps.length > config.maxRequests + 1) {
        timestamps.splice(0, timestamps.length - config.maxRequests - 1);
      }

      state.requestTimestamps = timestamps;
      state.count = timestamps.length;
      state.resetTime = (timestamps[0] ?? now) + config.windowMs;
      store.setState(key, state);

      const allowed = state.count <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - state.count);

      return { allowed, remaining, resetTime: state.resetTime };
    },
    { "rateLimit.maxRequests": config.maxRequests },
  );
}

/** Token bucket strategy - allows bursts up to capacity with constant refill rate */
export function tokenBucketStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<RateLimitResult> {
  return withSpan(
    "security.rateLimit.tokenBucket",
    async () => {
      if (!(store instanceof MemoryRateLimitStore)) {
        throw new TypeError("token-bucket requires MemoryRateLimitStore");
      }

      const now = Date.now();
      const refillRate = config.maxRequests / config.windowMs; // tokens per ms

      const existingState = store.getState(key);
      const state = existingState ?? {
        // Start with full bucket, consume one token
        count: config.maxRequests - 1,
        resetTime: now,
        requestTimestamps: [now],
      };

      if (!existingState) {
        store.setState(key, state);
        const remaining = Math.floor(state.count);
        const resetTime = now + (config.maxRequests - remaining) / refillRate;
        return { allowed: true, remaining, resetTime: Math.floor(resetTime) };
      }

      // Refill tokens based on time elapsed
      const timeElapsed = now - state.resetTime;
      const tokensToAdd = timeElapsed * refillRate;
      state.count = Math.min(config.maxRequests, state.count + tokensToAdd);
      state.resetTime = now;

      const resetTime = now + (config.maxRequests - state.count) / refillRate;

      // Check if we have tokens available
      if (state.count < 1) {
        store.setState(key, state);
        return {
          allowed: false,
          remaining: 0,
          resetTime: Math.floor(resetTime),
          retryAfterMs: Math.ceil((1 - state.count) / refillRate),
        };
      }

      // Consume one token
      state.count -= 1;
      store.setState(key, state);

      const remaining = Math.floor(state.count);
      return { allowed: true, remaining, resetTime: Math.floor(resetTime) };
    },
    { "rateLimit.maxRequests": config.maxRequests },
  );
}
