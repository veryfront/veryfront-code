/**
 * Production Features Module
 *
 * Enterprise-grade features for production deployments:
 * - Rate limiting
 * - Response caching
 * - Cost tracking
 * - Security (input validation, output filtering)
 *
 * @module veryfront/ai/production
 * @example
 * ```typescript
 * import {
 *   createRateLimiter,
 *   createCache,
 *   createCostTracker,
 *   securityMiddleware,
 * } from 'veryfront/ai/production';
 *
 * // Add to agent
 * const agent = agent({
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

// Rate limiting
export * from "./rate-limit/index.ts";

// Caching
export * from "./cache/index.ts";

// Cost tracking
export * from "./cost-tracking/index.ts";

// Security
export * from "./security/index.ts";
