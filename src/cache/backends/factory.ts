import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { CacheBackend } from "../types.ts";
import {
  type CodeCacheGateway,
  createTokenizingGateway,
  type TokenizingCacheGateway,
} from "../tokenizing-gateway.ts";
import { MemoryCacheBackend } from "./memory.ts";
import { isRedisConfigured, RedisCacheBackend } from "./redis.ts";
import { ApiCacheBackend } from "./api.ts";
import { getEnvValue } from "./helpers.ts";

const log = logger.component("cache-backend");

// Re-export gateway types for backward compatibility
export type { CodeCacheGateway, TokenizingCacheGateway };

export interface CacheBackendConfig {
  keyPrefix?: string;
  memoryMaxEntries?: number;
  preferredBackend?: "api" | "redis" | "memory";
  apiBaseUrl?: string;
  circuitBreakerName?: string;
}

export function isApiCacheAvailable(): boolean {
  const proxyMode = getEnv("PROXY_MODE");
  const nodeEnv = getEnv("NODE_ENV");
  const apiUrl = getEnvValue("VERYFRONT_API_BASE_URL");

  const isProduction = proxyMode === "1" ||
    nodeEnv === "production" ||
    !!(apiUrl && !apiUrl.includes("localhost") && !apiUrl.includes("lvh.me"));

  return isProduction && !!apiUrl;
}

export function createCacheBackend(config: CacheBackendConfig = {}): Promise<CacheBackend> {
  const {
    keyPrefix = "",
    memoryMaxEntries = 500,
    preferredBackend,
    apiBaseUrl,
    circuitBreakerName,
  } = config;

  return withSpan(
    SpanNames.CACHE_BACKEND_CREATE,
    async (span?: Span) => {
      const shouldUseApi = preferredBackend === "api" ||
        (!preferredBackend && isApiCacheAvailable());
      if (shouldUseApi) {
        log.debug("Using API backend (centralized cache)");
        span?.setAttribute("cache.backend.type", "api");
        return new ApiCacheBackend({ keyPrefix, apiBaseUrl, circuitBreakerName });
      }

      const shouldUseRedis = preferredBackend === "redis" ||
        (!preferredBackend && isRedisConfigured());
      if (shouldUseRedis) {
        const redisBackend = new RedisCacheBackend(keyPrefix ? `vf:${keyPrefix}:` : "vf:cache:");
        if (await redisBackend.initialize()) {
          log.debug("Using Redis backend");
          span?.setAttribute("cache.backend.type", "redis");
          return redisBackend;
        }
      }

      log.debug("Using memory backend");
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
  return backend.type !== "memory";
}

const DISTRIBUTED_CACHE_RETRY_MS = 30_000;

export function createDistributedCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
): () => Promise<CacheBackend | null> {
  let backend: CacheBackend | null | undefined;
  let lastFailureTime = 0;

  const singleflight = new (class {
    private promise: Promise<CacheBackend | null> | null = null;

    do(fn: () => Promise<CacheBackend | null>): Promise<CacheBackend | null> {
      if (!this.promise) {
        this.promise = fn().finally(() => {
          this.promise = null;
        });
      }
      return this.promise;
    }
  })();

  return () => {
    if (backend !== undefined) {
      if (
        backend === null && lastFailureTime > 0 &&
        Date.now() - lastFailureTime >= DISTRIBUTED_CACHE_RETRY_MS
      ) {
        backend = undefined;
        logger.debug(`[${name}] Retrying distributed cache initialization after failure`);
      }

      if (backend !== undefined) return Promise.resolve(backend);
    }

    return singleflight.do(async () => {
      try {
        const b = await factory();
        if (!isDistributedBackend(b)) {
          backend = null;
          lastFailureTime = 0;
          logger.debug(`[${name}] No distributed cache available (memory only)`);
          return null;
        }

        backend = b;
        lastFailureTime = 0;
        logger.debug(`[${name}] Distributed cache initialized`, { type: b.type });
        return b;
      } catch (error) {
        logger.debug(`[${name}] Failed to initialize distributed cache`, { error });
        backend = null;
        lastFailureTime = Date.now();
        return null;
      }
    });
  };
}

export const CacheBackends = {
  transform: () => createCacheBackend({ keyPrefix: "transform" }),
  file: () => createCacheBackend(),
  module: () => createCacheBackend({ keyPrefix: "module" }),
  render: () => createCacheBackend({ keyPrefix: "render" }),
  userKv: () => createCacheBackend({ keyPrefix: "kv", preferredBackend: "api" }),
  httpModule: () =>
    createCacheBackend({ keyPrefix: "http-module", circuitBreakerName: "api-cache-http" }),
  ssrModule: () => createCacheBackend({ keyPrefix: "ssr-module" }),
  projectCSS: () => createCacheBackend({ keyPrefix: "project-css" }),

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
