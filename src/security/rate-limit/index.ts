/**
 * Rate Limiting Module
 *
 * Provides rate limiting middleware to protect against abuse and DoS attacks.
 *
 * @module security/rate-limit
 *
 * @example
 * ```typescript
 * import { createRateLimiter, RateLimitPresets } from 'veryfront/security/rate-limit';
 *
 * // Use preset
 * const rateLimiter = RateLimitPresets.moderate();
 *
 * // Or create custom limiter
 * const customLimiter = createRateLimiter({
 *   maxRequests: 100,
 *   windowMs: 60000,
 *   strategy: "sliding-window",
 * });
 *
 * // Apply in request handler
 * export async function handler(request: Request) {
 *   return await rateLimiter(request, async (req) => {
 *     return new Response("OK");
 *   });
 * }
 * ```
 */

export { createRateLimiter, RateLimitPresets } from "./middleware.ts";
export { MemoryRateLimitStore } from "./memory-store.ts";
export {
  fixedWindowStrategy,
  slidingWindowStrategy,
  tokenBucketStrategy,
} from "./strategies.ts";
export type {
  RateLimitConfig,
  RateLimitState,
  RateLimitStore,
  RateLimitStrategy,
} from "./types.ts";
