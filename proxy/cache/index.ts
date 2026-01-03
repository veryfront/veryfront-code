/**
 * Token Cache Module
 *
 * Provides configurable caching for OAuth tokens.
 * Supports in-memory (single instance) and Redis (distributed) backends.
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

import type { CacheOptions, TokenCache } from "./types.ts";
import { MemoryCache } from "./memory-cache.ts";
import { RedisCache } from "./redis-cache.ts";

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
export function createCache(options: CacheOptions): TokenCache {
  switch (options.type) {
    case "redis":
      return new RedisCache(options.options);
    case "memory":
    default:
      return new MemoryCache(options.options);
  }
}

/**
 * Create cache from environment variables.
 *
 * Environment variables:
 * - CACHE_TYPE: "memory" or "redis" (default: "memory")
 * - REDIS_URL: Redis connection URL (required if CACHE_TYPE=redis)
 * - REDIS_PREFIX: Key prefix (default: "vf:token:")
 */
export function createCacheFromEnv(): TokenCache {
  const cacheType = Deno.env.get("CACHE_TYPE") || "memory";

  if (cacheType === "redis") {
    const url = Deno.env.get("REDIS_URL");
    if (!url) {
      console.warn("[Cache] CACHE_TYPE=redis but REDIS_URL not set, falling back to memory");
      return new MemoryCache();
    }

    return new RedisCache({
      url,
      prefix: Deno.env.get("REDIS_PREFIX") || "vf:token:",
    });
  }

  return new MemoryCache();
}
