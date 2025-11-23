/**
 * Rate Limiting Strategies
 *
 * Different algorithms for rate limiting
 */

import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";

/**
 * Fixed Window Strategy
 *
 * Simple counter that resets at fixed intervals.
 * Fast but can allow bursts at window boundaries.
 */
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

/**
 * Sliding Window Strategy
 *
 * More accurate than fixed window, prevents burst attacks.
 * Tracks individual request timestamps.
 */
export async function slidingWindowStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get state (need memory store for this)
  if (!(store instanceof MemoryRateLimitStore)) {
    // Fallback to fixed window for non-memory stores
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

  // Remove old timestamps outside the window
  if (state.requestTimestamps) {
    state.requestTimestamps = state.requestTimestamps.filter(
      (timestamp) => timestamp > windowStart,
    );
  } else {
    state.requestTimestamps = [];
  }

  // Add current timestamp
  state.requestTimestamps.push(now);
  state.count = state.requestTimestamps.length;
  state.resetTime = now + config.windowMs;

  // Save state
  store.setState(key, state);

  const allowed = state.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - state.count);

  return { allowed, remaining, resetTime: state.resetTime };
}

/**
 * Token Bucket Strategy
 *
 * Allows burst traffic up to bucket capacity.
 * Tokens refill at a constant rate.
 */
export async function tokenBucketStrategy(
  key: string,
  config: RateLimitConfig,
  store: RateLimitStore,
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const now = Date.now();
  const refillRate = config.maxRequests / config.windowMs; // tokens per ms

  // Get state
  if (!(store instanceof MemoryRateLimitStore)) {
    // Fallback to fixed window for non-memory stores
    return fixedWindowStrategy(key, config, store);
  }

  let state = store.getState(key);

  if (!state) {
    state = {
      count: config.maxRequests - 1, // Start with full bucket, consume one token
      resetTime: now,
      requestTimestamps: [now],
    };
  } else {
    // Refill tokens based on time elapsed
    const timeElapsed = now - state.resetTime;
    const tokensToAdd = timeElapsed * refillRate;
    state.count = Math.min(config.maxRequests, state.count + tokensToAdd);

    // Consume one token
    state.count = Math.max(0, state.count - 1);
    state.resetTime = now;
  }

  // Save state
  store.setState(key, state);

  const allowed = state.count >= 0;
  const remaining = Math.floor(state.count);
  const resetTime = now + (config.maxRequests - remaining) / refillRate;

  return { allowed, remaining, resetTime: Math.floor(resetTime) };
}
