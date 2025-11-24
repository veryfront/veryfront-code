/**
 * Rate Limiting Types
 *
 * Type definitions for rate limiting middleware
 */

/**
 * Rate limiting strategy
 */
export type RateLimitStrategy = "token-bucket" | "sliding-window" | "fixed-window";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the time window */
  maxRequests: number;

  /** Time window in milliseconds */
  windowMs: number;

  /** Strategy to use for rate limiting */
  strategy?: RateLimitStrategy;

  /** Custom key generator function (default: uses IP address) */
  keyGenerator?: (request: Request) => string;

  /** Custom handler for rate limit exceeded */
  onRateLimitExceeded?: (request: Request, key: string) => Response | Promise<Response>;

  /** Skip rate limiting for certain requests */
  skip?: (request: Request) => boolean | Promise<boolean>;

  /** Message to return when rate limit is exceeded */
  message?: string;

  /** Store implementation for tracking requests */
  store?: RateLimitStore;
}

/**
 * Rate limit store interface
 * Implementations can use memory, Redis, etc.
 */
export interface RateLimitStore {
  /**
   * Increment the request count for a key
   * Returns the current count
   */
  increment(key: string): Promise<number>;

  /**
   * Get the current request count for a key
   */
  get(key: string): Promise<number>;

  /**
   * Reset the count for a key
   */
  reset(key: string): Promise<void>;

  /**
   * Reset all counts
   */
  resetAll(): Promise<void>;
}

/**
 * Rate limit state for a key
 */
export interface RateLimitState {
  /** Number of requests made */
  count: number;

  /** Timestamp when the window resets */
  resetTime: number;

  /** Timestamps of recent requests (for sliding window) */
  requestTimestamps?: number[];
}
