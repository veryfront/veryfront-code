import { logger as baseLogger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { CacheBackend } from "../types.ts";
import {
  type CodeCacheGateway,
  createTokenizingGateway,
  type TokenizingCacheGateway,
} from "../tokenizing-gateway.ts";
import { MemoryCacheBackend } from "./memory.ts";
import { isRedisConfigured, RedisCacheBackend } from "./redis.ts";
import { ApiCacheBackend } from "./api.ts";
import { DiskCacheBackend } from "./disk.ts";
import { getEnvValue } from "./helpers.ts";
import {
  buildRedisCacheKeyPrefix,
  RedisCacheNamespace,
  type RedisCacheOwnershipMatcher,
  registerOwnedRedisCacheNamespace,
} from "./redis-keyspace.ts";

const logger = baseLogger.component("cache-backend");

const DEFAULT_MEMORY_MAX_ENTRIES = 500;

// Re-export gateway types for backward compatibility
export type { CodeCacheGateway, TokenizingCacheGateway };

export interface CacheBackendConfig {
  keyPrefix?: string;
  memoryMaxEntries?: number;
  preferredBackend?: "api" | "redis" | "disk" | "memory";
  apiBaseUrl?: string;
  /** Project identity bound to process-level API credentials. */
  projectRef?: string;
  circuitBreakerName?: string;
  /**
   * Exact parser for project ownership in a configured Redis namespace.
   * Without one, custom namespace keys are intentionally excluded from
   * project-scoped Redis listing and deletion.
   */
  redisProjectOwnershipMatcher?: RedisCacheOwnershipMatcher;
}

export function isApiCacheAvailable(): boolean {
  const proxyMode = getEnv("PROXY_MODE");
  const nodeEnv = getEnv("NODE_ENV");
  const apiUrl = getHostEnv("VERYFRONT_API_BASE_URL") ?? getEnvValue("VERYFRONT_API_BASE_URL");

  const isProduction = proxyMode === "1" ||
    nodeEnv === "production" ||
    !!(apiUrl && !apiUrl.includes("localhost") && !apiUrl.includes("lvh.me"));

  return isProduction && !!apiUrl;
}

export function isDiskCacheConfigured(): boolean {
  return getEnv("VF_CACHE_BACKEND") === "disk" || !!getEnv("VF_DISK_CACHE_DIR");
}

export function createCacheBackend(config: CacheBackendConfig = {}): Promise<CacheBackend> {
  const {
    keyPrefix = "",
    memoryMaxEntries = DEFAULT_MEMORY_MAX_ENTRIES,
    preferredBackend,
    apiBaseUrl,
    projectRef,
    circuitBreakerName,
    redisProjectOwnershipMatcher,
  } = config;

  return withSpan(
    SpanNames.CACHE_BACKEND_CREATE,
    async (span?: Span) => {
      const shouldUseApi = preferredBackend === "api" ||
        (!preferredBackend && isApiCacheAvailable());
      if (shouldUseApi) {
        logger.debug("Using API backend (centralized cache)");
        span?.setAttribute("cache.backend.type", "api");
        return new ApiCacheBackend({ keyPrefix, apiBaseUrl, circuitBreakerName, projectRef });
      }

      const shouldUseRedis = preferredBackend === "redis" ||
        (!preferredBackend && isRedisConfigured());
      if (shouldUseRedis) {
        const redisKeyPrefix = buildRedisCacheKeyPrefix(keyPrefix);
        registerOwnedRedisCacheNamespace({
          prefix: redisKeyPrefix,
          matchProjectOwnership: redisProjectOwnershipMatcher,
        });
        const redisBackend = new RedisCacheBackend(redisKeyPrefix);
        if (await redisBackend.initialize()) {
          logger.debug("Using Redis backend");
          span?.setAttribute("cache.backend.type", "redis");
          return redisBackend;
        }
        if (preferredBackend === "redis") {
          throw new Error("Explicit Redis cache backend could not be initialized");
        }
      }

      const shouldUseDisk = preferredBackend === "disk" ||
        (!preferredBackend && isDiskCacheConfigured());
      if (shouldUseDisk) {
        const diskDir = getEnv("VF_DISK_CACHE_DIR") || undefined;
        logger.debug("Using disk backend");
        span?.setAttribute("cache.backend.type", "disk");
        return new DiskCacheBackend(diskDir, keyPrefix || undefined);
      }

      logger.debug("Using memory backend");
      span?.setAttribute("cache.backend.type", "memory");
      return new MemoryCacheBackend(memoryMaxEntries);
    },
    {
      "cache.key_prefix": keyPrefix,
      "cache.preferred_backend": preferredBackend ?? "auto",
    },
  );
}

export function isDistributedBackend(backend: CacheBackend): boolean {
  return backend.type === "redis" || backend.type === "api";
}

const DISTRIBUTED_CACHE_RETRY_MS = 30_000;

export function createDistributedCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
): () => Promise<CacheBackend | null> {
  let backend: CacheBackend | null | undefined;
  let lastFailureTime: number | undefined;

  let inflight: Promise<CacheBackend | null> | null = null;

  return () => {
    if (backend !== undefined) {
      if (
        backend === null && lastFailureTime !== undefined &&
        Date.now() - lastFailureTime >= DISTRIBUTED_CACHE_RETRY_MS
      ) {
        backend = undefined;
        logger.debug(`[${name}] Retrying distributed cache initialization after failure`);
      }

      if (backend !== undefined) return Promise.resolve(backend);
    }

    if (!inflight) {
      inflight = (async () => {
        try {
          const b = await factory();
          if (!isDistributedBackend(b)) {
            backend = null;
            lastFailureTime = Date.now();
            logger.debug(`[${name}] Distributed cache degraded to memory; retry scheduled`);
            return null;
          }

          backend = b;
          lastFailureTime = undefined;
          logger.debug(`[${name}] Distributed cache initialized`, { type: b.type });
          return b;
        } catch (error) {
          logger.debug(`[${name}] Failed to initialize distributed cache`, {
            errorName: error instanceof Error ? error.name : typeof error,
          });
          backend = null;
          lastFailureTime = Date.now();
          return null;
        }
      })().finally(() => {
        inflight = null;
      });
    }

    return inflight;
  };
}

export const CacheBackends = {
  transform: () => createCacheBackend({ keyPrefix: RedisCacheNamespace.TRANSFORM }),
  file: () => createCacheBackend(),
  module: () => createCacheBackend({ keyPrefix: RedisCacheNamespace.MODULE }),
  render: () => createCacheBackend({ keyPrefix: RedisCacheNamespace.RENDER }),
  userKv: () => createCacheBackend({ keyPrefix: "kv", preferredBackend: "api" }),
  httpModule: () =>
    createCacheBackend({
      keyPrefix: RedisCacheNamespace.HTTP_MODULE,
      circuitBreakerName: "api-cache-http",
    }),
  ssrModule: () => createCacheBackend({ keyPrefix: RedisCacheNamespace.SSR_MODULE }),
  projectCSS: () => createCacheBackend({ keyPrefix: RedisCacheNamespace.PROJECT_CSS }),

  /**
   * Create a TokenizingCacheGateway for code storage.
   * This is the ONLY authorized way to store transformed code in distributed cache.
   *
   * The gateway automatically handles:
   * - Tokenization on write (replaces absolute paths with __VF_CACHE_DIR__)
   * - Detokenization on read (replaces tokens with local paths)
   * - Validation to ensure code is portable before storage
   *
   * @param name - Name for logging (e.g., "TRANSFORM-CACHE", "SSR-MODULE")
   * @param config - Cache backend configuration
   * @returns A gateway that enforces tokenization for code storage
   */
  codeStore: async (
    name: string,
    config: CacheBackendConfig = {},
  ): Promise<TokenizingCacheGateway> => {
    const backend = await createCacheBackend(config);
    return createTokenizingGateway(backend, name);
  },
};

/**
 * Create a distributed cache accessor that returns a TokenizingCacheGateway.
 * This wraps createDistributedCacheAccessor with automatic gateway creation.
 */
export function createDistributedCodeCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
): () => Promise<TokenizingCacheGateway | null> {
  const baseAccessor = createDistributedCacheAccessor(factory, name);

  return async () => {
    const backend = await baseAccessor();
    if (!backend) return null;
    return createTokenizingGateway(backend, name);
  };
}

// Re-export createTokenizingGateway for convenience
export { createTokenizingGateway };
