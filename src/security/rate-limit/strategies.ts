
import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

export async function fixedWindowStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const count = await store.increment(key);
  const allowed = count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - count);
  const resetTime = Date.now() + config.windowMs;

  return { allowed, remaining, resetTime };
}

export function slidingWindowStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  if (!(store instanceof MemoryRateLimitStore)) {
    return fixedWindowStrategy(key, config, store);
  }

  let state = store.getState(key);

  if (!state) {
    state = {
      count: 0,
      resetTime: now + config.windowMs,
      requestTimestamps: [],
    };
  }

  if (state.requestTimestamps) {
    state.requestTimestamps = state.requestTimestamps.filter(
      (timestamp) => timestamp > windowStart,
    );
  } else {
    state.requestTimestamps = [];
  }

  state.requestTimestamps.push(now);
  state.count = state.requestTimestamps.length;
  state.resetTime = now + config.windowMs;

  store.setState(key, state);

  const allowed = state.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - state.count);

  return Promise.resolve({ allowed, remaining, resetTime: state.resetTime });
}

export function tokenBucketStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const now = Date.now();
  // Refill rate: tokens per millisecond
  const refillRate = config.maxRequests / config.windowMs;

  if (!(store instanceof MemoryRateLimitStore)) {
    return fixedWindowStrategy(key, config, store);
  }

  let state = store.getState(key);

  if (!state) {
    // Start with full bucket minus one token for this request
    state = {
      count: config.maxRequests - 1,
      resetTime: now,
      requestTimestamps: [now],
    };
    store.setState(key, state);

    const remaining = Math.floor(state.count);
    // Time to refill one token
    const resetTime = now + Math.ceil(1 / refillRate);

    return Promise.resolve({ allowed: true, remaining, resetTime });
  }

  // Calculate tokens to add based on time elapsed
  const timeElapsed = now - state.resetTime;
  const tokensToAdd = timeElapsed * refillRate;
  state.count = Math.min(config.maxRequests, state.count + tokensToAdd);
  state.resetTime = now;

  // Check if we have at least one token
  if (state.count < 1) {
    store.setState(key, state);
    const remaining = 0;
    // Time until we have 1 token
    const resetTime = now + Math.ceil((1 - state.count) / refillRate);
    return Promise.resolve({ allowed: false, remaining, resetTime });
  }

  // Consume one token
  state.count = state.count - 1;
  store.setState(key, state);

  const remaining = Math.floor(state.count);
  // Time until bucket is full again
  const resetTime = now + Math.ceil((config.maxRequests - state.count) / refillRate);

  return Promise.resolve({ allowed: true, remaining, resetTime });
}
