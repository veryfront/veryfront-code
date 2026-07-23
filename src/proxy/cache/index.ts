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
export type { ResilientCacheOptions } from "./resilient-cache.ts";
export type { TracingTokenCacheOptions } from "./tracing-cache.ts";
export { MemoryCache } from "./memory-cache.ts";
export { ResilientCache } from "./resilient-cache.ts";
export { TokenCacheOperationError, TracingTokenCache } from "./tracing-cache.ts";

import type { CacheOptions, TokenCache } from "./types.ts";
import type { TokenCacheStore } from "../../extensions/cache/index.ts";
import { MemoryCache } from "./memory-cache.ts";
import { ResilientCache } from "./resilient-cache.ts";
import { TracingTokenCache } from "./tracing-cache.ts";
import { resolve } from "../../extensions/contracts.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";

const logger = proxyLogger.child({ module: "cache" });

function requireCacheType(value: unknown, name: string): "memory" | "redis" {
  if (value !== "memory" && value !== "redis") {
    throw new TypeError(`${name} must be "memory" or "redis"`);
  }
  return value;
}

function requireFactoryOptions(options: CacheOptions): CacheOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("cache options must be an object");
  }
  const type = requireCacheType((options as { type?: unknown }).type, "cache type");
  const nested = (options as { options?: unknown }).options;
  if (
    nested !== undefined && (typeof nested !== "object" || nested === null || Array.isArray(nested))
  ) {
    throw new TypeError("cache implementation options must be an object");
  }
  if (type === "redis" && nested === undefined) {
    throw new TypeError("redis cache options must be provided");
  }
  return options;
}

function createRedisCache(): TokenCache {
  const tokenCache = resolve<TokenCacheStore>("TokenCacheStore");
  logger.debug("[Cache] Using TokenCacheStore extension with resilient memory cache");
  return new ResilientCache(
    new TracingTokenCache(tokenCache),
    new MemoryCache(),
  );
}

/** Create the requested token cache, failing when its required extension is absent. */
export async function createCache(options: CacheOptions): Promise<TokenCache> {
  const validatedOptions = requireFactoryOptions(options);
  return withSpan(
    "cache.create",
    async () => {
      if (validatedOptions.type === "redis") {
        return createRedisCache();
      }
      return new MemoryCache(validatedOptions.options);
    },
    { "cache.type": validatedOptions.type },
  );
}

/** Create a token cache from the validated `CACHE_TYPE` environment setting. */
export async function createCacheFromEnv(): Promise<TokenCache> {
  const configuredType = getEnv("CACHE_TYPE");
  const cacheType = requireCacheType(configuredType || "memory", "CACHE_TYPE");

  return withSpan(
    "cache.createFromEnv",
    async () => {
      return cacheType === "redis" ? createRedisCache() : new MemoryCache();
    },
    { "cache.type": cacheType },
  );
}
