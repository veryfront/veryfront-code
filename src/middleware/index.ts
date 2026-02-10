/**
 * Middleware
 *
 * @module middleware
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
