/**
 * Middleware - Rate Limit
 *
 * @module agent/middleware/rate-limit
 */

export {
  createRateLimiter,
  type RateLimitConfig,
  rateLimitMiddleware,
  type RateLimitResult,
} from "./limiter.ts";
