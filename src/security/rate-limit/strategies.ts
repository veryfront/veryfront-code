import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

/** Fixed window strategy - simple counter that resets at fixed intervals */
export async function fixedWindowStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<RateLimitResult> {
  const count = await store.increment(key);
  const allowed = count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - count);
  const resetTime = Date.now() + config.windowMs;

  return { allowed, remaining, resetTime };
}

/** Sliding window strategy - tracks individual timestamps to prevent bursts */
export async function slidingWindowStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<RateLimitResult> {
  // Fallback to fixed window for non-memory stores
  if (!(store instanceof MemoryRateLimitStore)) {
    return await fixedWindowStrategy(key, config, store);
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;
  const state = store.getState(key) ?? {
    count: 0,
    resetTime: now + config.windowMs,
    requestTimestamps: [],
  };

  // Remove old timestamps outside the window and add current
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
}

/** Token bucket strategy - allows bursts up to capacity with constant refill rate */
export async function tokenBucketStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<RateLimitResult> {
  // Fallback to fixed window for non-memory stores
  if (!(store instanceof MemoryRateLimitStore)) {
    return await fixedWindowStrategy(key, config, store);
  }

  const now = Date.now();
  const refillRate = config.maxRequests / config.windowMs; // tokens per ms
  const existingState = store.getState(key);

  if (!existingState) {
    // Start with full bucket, consume one token
    const state = {
      count: config.maxRequests - 1,
      resetTime: now,
      requestTimestamps: [now],
    };
    store.setState(key, state);
    const remaining = Math.floor(state.count);
    const resetTime = now + (config.maxRequests - remaining) / refillRate;
    return { allowed: true, remaining, resetTime: Math.floor(resetTime) };
  }

  // Refill tokens based on time elapsed
  const timeElapsed = now - existingState.resetTime;
  const tokensToAdd = timeElapsed * refillRate;
  existingState.count = Math.min(config.maxRequests, existingState.count + tokensToAdd);
  existingState.resetTime = now;

  // Check if we have tokens available
  if (existingState.count < 1) {
    store.setState(key, existingState);
    const resetTime = now + (config.maxRequests - existingState.count) / refillRate;
    return { allowed: false, remaining: 0, resetTime: Math.floor(resetTime) };
  }

  // Consume one token
  existingState.count -= 1;
  store.setState(key, existingState);

  const remaining = Math.floor(existingState.count);
  const resetTime = now + (config.maxRequests - remaining) / refillRate;
  return { allowed: true, remaining, resetTime: Math.floor(resetTime) };
}
