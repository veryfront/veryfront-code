import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
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
      const count = await store.increment(key);
      const allowed = count <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - count);
      const resetTime = Date.now() + config.windowMs;

      return { allowed, remaining, resetTime };
    },
    { "rateLimit.key": key, "rateLimit.maxRequests": config.maxRequests },
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
      // Fallback to fixed window for non-memory stores
      if (!(store instanceof MemoryRateLimitStore)) {
        return fixedWindowStrategy(key, config, store);
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

      state.requestTimestamps = timestamps;
      state.count = timestamps.length;
      state.resetTime = now + config.windowMs;
      store.setState(key, state);

      const allowed = state.count <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - state.count);

      return { allowed, remaining, resetTime: state.resetTime };
    },
    { "rateLimit.key": key, "rateLimit.maxRequests": config.maxRequests },
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
      // Fallback to fixed window for non-memory stores
      if (!(store instanceof MemoryRateLimitStore)) {
        return fixedWindowStrategy(key, config, store);
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
        return { allowed: false, remaining: 0, resetTime: Math.floor(resetTime) };
      }

      // Consume one token
      state.count -= 1;
      store.setState(key, state);

      const remaining = Math.floor(state.count);
      return { allowed: true, remaining, resetTime: Math.floor(resetTime) };
    },
    { "rateLimit.key": key, "rateLimit.maxRequests": config.maxRequests },
  );
}
