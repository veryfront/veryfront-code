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
  MiddlewareExecutionAdapter,
  MiddlewareFactory,
  MiddlewareHandler,
  Next,
} from "./core/types.ts";

export type { CORSOptions as CorsOptions, OriginValidator } from "#veryfront/security";
import { cors as createCors, type CORSOptions } from "#veryfront/security";
import type { MiddlewareHandler } from "./core/types.ts";

/** Create CORS middleware. */
export function cors(config?: boolean | CORSOptions): MiddlewareHandler {
  return createCors(config);
}

export {
  authRateLimit,
  type AuthRateLimitOptions,
  MemoryRateLimitStore,
  rateLimit,
  type RateLimitOptions,
} from "./builtin/security/rate-limit.ts";
export {
  type RedisRateLimitOptions,
  RedisRateLimitStore,
} from "./builtin/security/redis-rate-limit.ts";
export type { RateLimitEntry, RateLimitStore } from "./builtin/security/types.ts";

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
  type TimeoutEnvironmentConfig,
  timeoutFromEnv,
  type TimeoutOptions,
} from "./builtin/timeout.ts";
