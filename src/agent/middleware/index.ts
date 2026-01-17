/**
 * Agent Middleware Module
 *
 * Production-grade middleware for agents:
 * - Rate limiting
 * - Response caching
 * - Cost tracking
 * - Security (input validation, output filtering)
 *
 * @module veryfront/agent/middleware
 *
 * @example
 * ```typescript
 * import {
 *   rateLimitMiddleware,
 *   cacheMiddleware,
 *   costTrackingMiddleware,
 *   securityMiddleware,
 * } from 'veryfront/agent/middleware';
 *
 * const myAgent = agent({
 *   model: 'openai/gpt-4',
 *   middleware: [
 *     rateLimitMiddleware({ strategy: 'token-bucket', maxRequests: 10, windowMs: 60000 }),
 *     cacheMiddleware({ strategy: 'ttl', ttl: 300000 }),
 *     costTrackingMiddleware({ pricing: {...} }),
 *     securityMiddleware({ input: {...}, output: {...} }),
 *   ],
 * });
 * ```
 */

// Middleware chain
export { createMiddlewareChain, MiddlewareChain } from "./chain.ts";

// Rate limiting
export {
  createRateLimiter,
  rateLimitMiddleware,
  type RateLimitConfig,
  type RateLimitResult,
} from "./rate-limit/index.ts";

// Caching
export {
  cacheMiddleware,
  createCache,
  type CacheConfig,
  type CacheEntry,
} from "./cache/index.ts";

// Cost tracking
export {
  costTrackingMiddleware,
  createCostTracker,
  type CostConfig,
  type UsageRecord,
  type UsageSummary,
} from "./cost-tracking/index.ts";

// Security
export {
  COMMON_BLOCKED_PATTERNS,
  InputValidator,
  OutputFilter,
  securityMiddleware,
  type SecurityConfig,
  type SecurityViolation,
} from "./security/index.ts";
