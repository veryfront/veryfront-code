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

export async function createCache(options: CacheOptions): Promise<TokenCache> {
  return withSpan(
    "cache.create",
    async () => {
      if (options.type === "redis") return new RedisCache(options.options);
      return new MemoryCache(options.options);
    },
    { "cache.type": options.type },
  );
}

export async function createCacheFromEnv(): Promise<TokenCache> {
  const cacheType = getEnv("CACHE_TYPE") || "memory";

  return withSpan(
    "cache.createFromEnv",
    async () => {
      if (cacheType !== "redis") return new MemoryCache();

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
    },
    { "cache.type": cacheType },
  );
}
