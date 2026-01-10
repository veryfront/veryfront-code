/**
 * Rate Limiting System
 *
 * Prevents abuse and ensures fair usage of AI resources.
 * Supports multiple strategies: fixed window, sliding window, token bucket.
 */

import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface RateLimitConfig {
  /** Strategy type */
  strategy: "fixed-window" | "sliding-window" | "token-bucket";

  /** Maximum requests */
  maxRequests: number;

  /** Time window in milliseconds */
  windowMs: number;

  /** Identifier function (e.g., user ID, IP address) */
  identify?: (context: Record<string, unknown>) => string;

  /** Custom error message */
  errorMessage?: string;
}

export interface RateLimitResult {
  /** Allowed or not */
  allowed: boolean;

  /** Requests remaining */
  remaining: number;

  /** Reset time (timestamp) */
  resetAt: number;

  /** Retry after (seconds) */
  retryAfter?: number;
}

/**
 * Fixed Window Rate Limiter
 */
class FixedWindowLimiter {
  private requests = new Map<string, { count: number; resetAt: number }>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    // No previous requests or window expired
    if (!entry || now >= entry.resetAt) {
      const resetAt = now + this.config.windowMs;

      this.requests.set(identifier, {
        count: 1,
        resetAt,
      });

      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt,
      };
    }

    // Within window
    if (entry.count < this.config.maxRequests) {
      entry.count++;

      return {
        allowed: true,
        remaining: this.config.maxRequests - entry.count,
        resetAt: entry.resetAt,
      };
    }

    // Limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  clear(): void {
    this.requests.clear();
  }
}

/**
 * Token Bucket Rate Limiter (more flexible)
 */
class TokenBucketLimiter {
  private buckets = new Map<
    string,
    { tokens: number; lastRefill: number }
  >();
  private config: RateLimitConfig;
  private refillRate: number;

  constructor(config: RateLimitConfig) {
    this.config = config;
    // Refill rate: tokens per millisecond
    this.refillRate = config.maxRequests / config.windowMs;
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(identifier);

    // Initialize bucket if not exists
    if (!bucket) {
      bucket = {
        tokens: this.config.maxRequests - 1,
        lastRefill: now,
      };
      this.buckets.set(identifier, bucket);

      return {
        allowed: true,
        remaining: bucket.tokens,
        resetAt: now + this.config.windowMs,
      };
    }

    // Refill tokens based on time passed
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = timePassed * this.refillRate;

    bucket.tokens = Math.min(
      this.config.maxRequests,
      bucket.tokens + tokensToAdd,
    );
    bucket.lastRefill = now;

    // Check if we have tokens
    if (bucket.tokens >= 1) {
      bucket.tokens--;

      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAt: now + this.config.windowMs,
      };
    }

    // No tokens available
    const timeUntilToken = (1 - bucket.tokens) / this.refillRate;

    return {
      allowed: false,
      remaining: 0,
      resetAt: now + this.config.windowMs,
      retryAfter: Math.ceil(timeUntilToken / 1000),
    };
  }

  reset(identifier: string): void {
    this.buckets.delete(identifier);
  }

  clear(): void {
    this.buckets.clear();
  }
}

/**
 * Create a rate limiter
 */
export function createRateLimiter(config: RateLimitConfig) {
  let limiter: FixedWindowLimiter | TokenBucketLimiter;

  switch (config.strategy) {
    case "fixed-window":
      limiter = new FixedWindowLimiter(config);
      break;
    case "token-bucket":
      limiter = new TokenBucketLimiter(config);
      break;
    case "sliding-window":
      // Use token bucket as approximation for sliding window
      limiter = new TokenBucketLimiter(config);
      break;
    default:
      limiter = new FixedWindowLimiter(config);
  }

  return {
    /**
     * Check if request is allowed
     */
    check(context?: Record<string, unknown>): RateLimitResult {
      const identifier = config.identify ? config.identify(context!) : "default";

      return limiter.check(identifier);
    },

    /**
     * Reset rate limit for identifier
     */
    reset(context?: Record<string, unknown>): void {
      const identifier = config.identify ? config.identify(context!) : "default";

      limiter.reset(identifier);
    },

    /**
     * Clear all rate limits
     */
    clear(): void {
      limiter.clear();
    },
  };
}

/**
 * Create rate limit middleware for agents
 */
export function rateLimitMiddleware(config: RateLimitConfig) {
  const limiter = createRateLimiter(config);

  return <T>(context: Record<string, unknown>, next: () => Promise<T>): Promise<T> => {
    const result = limiter.check(context);

    if (!result.allowed) {
      throw toError(createError({
        type: "agent",
        message: config.errorMessage ||
          `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      }));
    }

    return next();
  };
}
