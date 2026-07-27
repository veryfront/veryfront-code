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

import type { CacheOptions, MemoryCacheOptions, TokenCache } from "./types.ts";
import type { TokenCacheStore } from "../../extensions/cache/index.ts";
import { MemoryCache } from "./memory-cache.ts";
import { ResilientCache } from "./resilient-cache.ts";
import { TracingTokenCache } from "./tracing-cache.ts";
import { tryResolve } from "../../extensions/contracts.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { assertCacheOptionsObject } from "./validation.ts";

const logger = proxyLogger.child({ module: "cache" });

const MISSING_EXTENSION_INFO =
  "Redis cache was requested, but no TokenCacheStore is registered. Install and configure @veryfront/ext-cache-redis.";

function requireTokenCacheStore(): TokenCacheStore {
  const tokenCache = tryResolve<TokenCacheStore>("TokenCacheStore");
  if (!tokenCache) {
    throw INITIALIZATION_ERROR.create({ detail: MISSING_EXTENSION_INFO });
  }
  return tokenCache;
}

export async function createCache(options: CacheOptions): Promise<TokenCache> {
  assertCacheOptionsObject(options, "Proxy cache options", ["type", "options"]);
  const typeDescriptor = Object.getOwnPropertyDescriptor(options, "type");
  if (!typeDescriptor || !("value" in typeDescriptor)) {
    throw new TypeError("Proxy cache type must be a data property");
  }
  const cacheType = typeDescriptor.value;
  if (cacheType !== "memory" && cacheType !== "redis") {
    throw new TypeError("Proxy cache type must be memory or redis");
  }
  const optionsDescriptor = Object.getOwnPropertyDescriptor(options, "options");
  if (optionsDescriptor && !("value" in optionsDescriptor)) {
    throw new TypeError("Proxy cache backend options must be a data property");
  }
  const backendOptions = optionsDescriptor && "value" in optionsDescriptor
    ? optionsDescriptor.value
    : undefined;
  return withSpan(
    "cache.create",
    async () => {
      if (cacheType === "redis") {
        if (backendOptions !== undefined) {
          throw new TypeError(
            "Redis connection options belong to the ext-cache-redis extension",
          );
        }
        return new TracingTokenCache(requireTokenCacheStore());
      }
      return new MemoryCache(backendOptions as MemoryCacheOptions | undefined);
    },
    { "cache.type": cacheType },
  );
}

export async function createCacheFromEnv(): Promise<TokenCache> {
  const cacheType = getEnv("CACHE_TYPE") || "memory";
  if (cacheType !== "memory" && cacheType !== "redis") {
    throw new TypeError("CACHE_TYPE must be memory or redis");
  }

  return withSpan(
    "cache.createFromEnv",
    async () => {
      if (cacheType !== "redis") return new MemoryCache();

      // Wrap the extension-provided cache with a memory fallback so a Redis
      // outage does not take the proxy down. TracingTokenCache sits between
      // ResilientCache and the extension impl so spans wrap the actual
      // primary-cache attempt (mirrors the pre-extraction RedisCache which
      // had inner withSpan calls).
      logger.debug("[Cache] Using TokenCacheStore extension with memory fallback (ResilientCache)");
      const traced = new TracingTokenCache(requireTokenCacheStore());
      return new ResilientCache(traced, new MemoryCache());
    },
    { "cache.type": cacheType },
  );
}
