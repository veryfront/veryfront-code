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
import type { RedisTokenCacheStoreAcquisition } from "./redis-extension.ts";
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

export interface CacheFromEnvOptions {
  /**
   * Explicit startup acquisition. A borrowed store remains open when the
   * proxy-owned cache wrapper closes.
   */
  redisStore?: RedisTokenCacheStoreAcquisition;
}

function requireTokenCacheStore(): TokenCacheStore {
  const tokenCache = tryResolve<TokenCacheStore>("TokenCacheStore");
  if (!tokenCache) {
    throw INITIALIZATION_ERROR.create({ detail: MISSING_EXTENSION_INFO });
  }
  return tokenCache;
}

function readRedisStoreAcquisition(
  options: CacheFromEnvOptions,
): RedisTokenCacheStoreAcquisition | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(options, "redisStore");
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError("Proxy cache redisStore must be a data property");
  }
  const acquisition = descriptor.value;
  if (acquisition === undefined) return undefined;
  assertCacheOptionsObject(
    acquisition,
    "Proxy Redis store acquisition",
    ["kind", "store"],
  );
  const kindDescriptor = Object.getOwnPropertyDescriptor(acquisition, "kind");
  const storeDescriptor = Object.getOwnPropertyDescriptor(acquisition, "store");
  if (
    !kindDescriptor || !("value" in kindDescriptor) ||
    !storeDescriptor || !("value" in storeDescriptor)
  ) {
    throw new TypeError("Proxy Redis store acquisition must use data properties");
  }
  const kind = kindDescriptor.value;
  const store = storeDescriptor.value;
  if (kind === "disabled") {
    if (store !== null) {
      throw new TypeError("Disabled Proxy Redis store acquisition must not contain a store");
    }
    return acquisition as RedisTokenCacheStoreAcquisition;
  }
  if (
    (kind !== "borrowed" && kind !== "created") ||
    store === null ||
    typeof store !== "object" ||
    Array.isArray(store)
  ) {
    throw new TypeError("Proxy Redis store acquisition is invalid");
  }
  return acquisition as RedisTokenCacheStoreAcquisition;
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

export async function createCacheFromEnv(
  options: CacheFromEnvOptions = {},
): Promise<TokenCache> {
  assertCacheOptionsObject(options, "Proxy environment cache options", ["redisStore"]);
  const redisStore = readRedisStoreAcquisition(options);
  const cacheType = getEnv("CACHE_TYPE") || "memory";
  if (cacheType !== "memory" && cacheType !== "redis") {
    throw new TypeError("CACHE_TYPE must be memory or redis");
  }
  if (cacheType === "memory" && redisStore && redisStore.kind !== "disabled") {
    throw new TypeError("A Redis store cannot be supplied when CACHE_TYPE=memory");
  }
  if (cacheType === "redis" && redisStore?.kind === "disabled") {
    throw new TypeError("CACHE_TYPE=redis requires an acquired Redis store");
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
      const store = redisStore?.store ?? requireTokenCacheStore();
      const traced = new TracingTokenCache(store, {
        closeInner: redisStore?.kind !== "borrowed",
      });
      return new ResilientCache(traced, new MemoryCache());
    },
    { "cache.type": cacheType },
  );
}
