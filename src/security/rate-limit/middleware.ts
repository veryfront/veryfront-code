/**
 * Rate Limiting Middleware
 *
 * Protects endpoints from abuse by limiting request rates.
 * Supports multiple strategies and custom stores.
 */

import { logger } from "@veryfront/utils";
import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import { fixedWindowStrategy, slidingWindowStrategy, tokenBucketStrategy } from "./strategies.ts";

/**
 * Default key generator - uses IP address
 */
function defaultKeyGenerator(request: Request): string {
  // Try to get real IP from headers (behind proxy)
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback to unknown
  return "unknown";
}

/**
 * Default rate limit exceeded handler
 */
function defaultRateLimitExceeded(
  _request: Request,
  _key: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

/**
 * Create rate limiting middleware
 *
 * @param config Rate limit configuration
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * // Basic usage with defaults (100 requests per minute)
 * const rateLimiter = createRateLimiter({
 *   maxRequests: 100,
 *   windowMs: 60000,
 * });
 *
 * // In your request handler
 * const response = await rateLimiter(request, async (req) => {
 *   return new Response("OK");
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Advanced usage with custom configuration
 * const rateLimiter = createRateLimiter({
 *   maxRequests: 10,
 *   windowMs: 60000,
 *   strategy: "sliding-window",
 *   keyGenerator: (request) => {
 *     // Rate limit by API key instead of IP
 *     return request.headers.get("x-api-key") || "anonymous";
 *   },
 *   skip: async (request) => {
 *     // Skip rate limiting for admin users
 *     const apiKey = request.headers.get("x-api-key");
 *     return apiKey === "admin-key";
 *   },
 * });
 * ```
 */
export function createRateLimiter(config: RateLimitConfig) {
  const {
    maxRequests,
    windowMs,
    strategy = "fixed-window",
    keyGenerator = defaultKeyGenerator,
    onRateLimitExceeded,
    skip,
    message = `Too many requests. Please try again later.`,
    store = new MemoryRateLimitStore(),
  } = config;

  // Select strategy function based on configuration
  function getStrategyFn() {
    switch (strategy) {
      case "sliding-window":
        return slidingWindowStrategy;
      case "token-bucket":
        return tokenBucketStrategy;
      default:
        return fixedWindowStrategy;
    }
  }
  const strategyFn = getStrategyFn();

  return async function rateLimitMiddleware(
    request: Request,
    next: (req: Request) => Promise<Response>,
  ): Promise<Response> {
    try {
      // Check if we should skip rate limiting
      if (skip && await skip(request)) {
        return await next(request);
      }

      // Generate key for this request
      const key = keyGenerator(request);

      // Apply rate limiting strategy
      const result = await strategyFn(key, { ...config, maxRequests, windowMs }, store);

      // Add rate limit headers
      const headers = new Headers();
      headers.set("X-RateLimit-Limit", maxRequests.toString());
      headers.set("X-RateLimit-Remaining", result.remaining.toString());
      headers.set("X-RateLimit-Reset", result.resetTime.toString());

      if (!result.allowed) {
        logger.warn(`Rate limit exceeded for key: ${key}`, {
          key,
          limit: maxRequests,
          window: windowMs,
        });

        // Call custom handler or use default
        if (onRateLimitExceeded) {
          return await onRateLimitExceeded(request, key);
        }

        const response = defaultRateLimitExceeded(request, key, message);

        // Add rate limit headers to error response
        for (const [name, value] of headers.entries()) {
          response.headers.set(name, value);
        }

        return response;
      }

      // Request allowed - proceed
      const response = await next(request);

      // Add rate limit headers to successful response
      for (const [name, value] of headers.entries()) {
        response.headers.set(name, value);
      }

      return response;
    } catch (error) {
      // Log error but don't block request
      logger.error("Rate limiting error", {
        error: error instanceof Error ? error.message : String(error),
      });

      // On error, allow request through (fail open)
      return await next(request);
    }
  };
}

/**
 * Create rate limiter with preset configurations
 */
export const RateLimitPresets = {
  /**
   * Strict rate limit for API endpoints (10 req/min)
   */
  strict: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 10,
      windowMs: 60000,
      strategy: "sliding-window",
      store,
    }),

  /**
   * Moderate rate limit for web pages (100 req/min)
   */
  moderate: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 100,
      windowMs: 60000,
      strategy: "fixed-window",
      store,
    }),

  /**
   * Lenient rate limit for public APIs (1000 req/hour)
   */
  lenient: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 1000,
      windowMs: 3600000,
      strategy: "fixed-window",
      store,
    }),

  /**
   * Very strict rate limit for auth endpoints (5 req/15min)
   */
  auth: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 5,
      windowMs: 900000,
      strategy: "sliding-window",
      message: "Too many authentication attempts. Please try again later.",
      store,
    }),
};
