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
  type RateLimitConfig,
  rateLimitMiddleware,
  type RateLimitResult,
} from "./rate-limit/index.ts";

// Caching
export { type CacheConfig, type CacheEntry, cacheMiddleware, createCache } from "./cache/index.ts";

// Cost tracking
export {
  type CostConfig,
  costTrackingMiddleware,
  createCostTracker,
  type UsageRecord,
  type UsageSummary,
} from "./cost-tracking/index.ts";

// Security
export {
  COMMON_BLOCKED_PATTERNS,
  InputValidator,
  OutputFilter,
  type SecurityConfig,
  securityMiddleware,
  type SecurityViolation,
} from "./security/index.ts";
