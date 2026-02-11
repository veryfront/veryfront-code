/**
 * CORS, rate limiting, logging, and timeout middleware.
 *
 * @module middleware
 *
 * @example Single middleware
 * ```ts
 * import { cors } from "veryfront/middleware";
 *
 * const corsMiddleware = cors({ origin: "https://example.com" });
 * ```
 *
 * @example Pipeline composition
 * ```ts
 * import { MiddlewarePipeline, cors, rateLimit, logger, timeout } from "veryfront/middleware";
 *
 * const pipeline = new MiddlewarePipeline()
 *   .use(cors({ origin: "https://example.com" }))
 *   .use(rateLimit({ maxRequests: 100, windowMs: 60_000 }))
 *   .use(logger({ format: "combined" }))
 *   .use(timeout({ timeoutMs: 30_000 }));
 * ```
 */

export {
  MiddlewareContext,
  MiddlewarePipeline,
  type MiddlewarePipelineOptions,
} from "./core/index.ts";
export type {
  Context,
  ExecutionContext,
  MiddlewareFactory,
  MiddlewareHandler,
  Next,
} from "./core/types.ts";

export type { CorsOptions } from "./builtin/types.ts";
export { cors } from "#veryfront/security";

export {
  MemoryRateLimitStore,
  rateLimit,
  type RateLimitOptions,
} from "./builtin/security/rate-limit.ts";
export {
  type RedisRateLimitOptions,
  RedisRateLimitStore,
} from "./builtin/security/redis-rate-limit.ts";
export type { RateLimitStore } from "./builtin/security/types.ts";

export {
  devLogger,
  type LogFormat,
  logger,
  type LoggerOptions,
  prodLogger,
} from "./builtin/logger.ts";

export {
  getTimeoutFromEnv,
  timeout,
  timeoutFromEnv,
  type TimeoutOptions,
} from "./builtin/timeout.ts";
