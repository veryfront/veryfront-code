/**
 * Token Cache Module
 *
 * Provides configurable caching for OAuth tokens.
 * Supports in-memory (single instance) and Redis (distributed) backends.
 * Redis cache includes automatic fallback to memory when Redis is unavailable.
 */

export type {
  CacheOptions,
  CacheStats,
  MemoryCacheOptions,
  RedisCacheOptions,
  TokenCache,
  TokenCacheEntry,
} from "./types.ts";
export { MemoryCache } from "./memory-cache.ts";
export { RedisCache } from "./redis-cache.ts";
export { ResilientCache } from "./resilient-cache.ts";

import type { CacheOptions, TokenCache } from "./types.ts";
import { MemoryCache } from "./memory-cache.ts";
import { RedisCache } from "./redis-cache.ts";
import { ResilientCache } from "./resilient-cache.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";

const logger = proxyLogger.child({ module: "cache" });

/**
 * Create a token cache based on configuration.
 *
 * @example
 * ```typescript
 * // In-memory cache (default)
 * const cache = createCache({ type: "memory" });
 *
 * // Redis cache for distributed deployments
 * const cache = createCache({
 *   type: "redis",
 *   options: { url: "redis://localhost:6379" }
 * });
 * ```
 */
export async function createCache(options: CacheOptions): Promise<TokenCache> {
  return withSpan("cache.create", async () => {
    switch (options.type) {
      case "redis":
        return new RedisCache(options.options);
      case "memory":
      default:
        return new MemoryCache(options.options);
    }
  }, { "cache.type": options.type });
}

/**
 * Create cache from environment variables.
 *
 * Environment variables:
 * - CACHE_TYPE: "memory" or "redis" (default: "memory")
 * - REDIS_URL: Redis connection URL (required if CACHE_TYPE=redis)
 * - REDIS_PREFIX: Key prefix (default: "vf:token:")
 *
 * When CACHE_TYPE=redis, automatically wraps with ResilientCache for
 * graceful fallback to memory when Redis is unavailable.
 */
export async function createCacheFromEnv(): Promise<TokenCache> {
  return withSpan("cache.createFromEnv", async () => {
    const cacheType = getEnv("CACHE_TYPE") || "memory";

    if (cacheType === "redis") {
      const url = getEnv("REDIS_URL");
      if (!url) {
        logger.warn("[Cache] CACHE_TYPE=redis but REDIS_URL not set, falling back to memory");
        return new MemoryCache();
      }

      const redisCache = new RedisCache({
        url,
        prefix: getEnv("REDIS_PREFIX") || "vf:token:",
      });

      // Wrap Redis with resilient fallback to memory cache
      // This ensures the proxy continues to function when Redis is unavailable
      logger.info("[Cache] Using Redis with memory fallback (ResilientCache)");
      return new ResilientCache(redisCache, new MemoryCache());
    }

    return new MemoryCache();
  }, { "cache.type": getEnv("CACHE_TYPE") || "memory" });
}
