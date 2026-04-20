/**
 * Proxy Cache
 *
 * @module proxy/cache
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
export { ResilientCache } from "./resilient-cache.ts";
export { TracingTokenCache } from "./tracing-cache.ts";

import type { CacheOptions, TokenCache } from "./types.ts";
import type { TokenCacheStore } from "../../extensions/interfaces/token-cache-store.ts";
import { MemoryCache } from "./memory-cache.ts";
import { ResilientCache } from "./resilient-cache.ts";
import { TracingTokenCache } from "./tracing-cache.ts";
import { tryResolve } from "../../extensions/contracts.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";

const logger = proxyLogger.child({ module: "cache" });

const MISSING_EXTENSION_INFO =
  "TokenCacheStore contract not provided — install @veryfront/ext-redis or scaffold extensions/ext-redis/";

export async function createCache(options: CacheOptions): Promise<TokenCache> {
  return withSpan(
    "cache.create",
    async () => {
      if (options.type === "redis") {
        const tokenCache = tryResolve<TokenCacheStore>("TokenCacheStore");
        if (tokenCache) return new TracingTokenCache(tokenCache as unknown as TokenCache);
        logger.info(MISSING_EXTENSION_INFO);
        return new MemoryCache(undefined);
      }
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

      const tokenCache = tryResolve<TokenCacheStore>("TokenCacheStore");
      if (!tokenCache) {
        // Redis was requested via config/env but no extension registered the
        // TokenCacheStore contract. Log an info (misconfiguration, not error),
        // then fall back to an in-memory cache so the proxy still boots.
        logger.info(MISSING_EXTENSION_INFO);
        return new MemoryCache();
      }

      // Wrap the extension-provided cache with a memory fallback so a Redis
      // outage does not take the proxy down. TracingTokenCache sits between
      // ResilientCache and the extension impl so spans wrap the actual
      // primary-cache attempt (mirrors the pre-extraction RedisCache which
      // had inner withSpan calls).
      logger.debug("[Cache] Using TokenCacheStore extension with memory fallback (ResilientCache)");
      const traced = new TracingTokenCache(tokenCache as unknown as TokenCache);
      return new ResilientCache(traced, new MemoryCache());
    },
    { "cache.type": cacheType },
  );
}
