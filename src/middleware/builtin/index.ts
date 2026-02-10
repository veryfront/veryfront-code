/**
 * Middleware Builtin
 *
 * @module middleware/builtin
 */

export {
  type AnyMiddlewareContext,
  type CorsOptions,
  type CorsValidationResult,
  getRequest,
  type Middleware,
  type MiddlewareContext,
  type Next,
  type OriginValidator,
} from "./types.ts";

export { cors } from "#veryfront/security";

export { MemoryRateLimitStore, rateLimit, type RateLimitOptions } from "./security/rate-limit.ts";
export { type RedisRateLimitOptions, RedisRateLimitStore } from "./security/redis-rate-limit.ts";
export type { RateLimitStore } from "./security/types.ts";

export { devLogger, type LogFormat, logger, type LoggerOptions, prodLogger } from "./logger.ts";

export { getTimeoutFromEnv, timeout, timeoutFromEnv, type TimeoutOptions } from "./timeout.ts";
