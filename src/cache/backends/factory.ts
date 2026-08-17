import { logger as baseLogger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isDevelopment } from "#veryfront/platform/environment.ts";
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

const logger = baseLogger.component("cache-backend");

const DEFAULT_MEMORY_MAX_ENTRIES = 500;

// Re-export gateway types for backward compatibility
export type { CodeCacheGateway, TokenizingCacheGateway };

export interface CacheBackendConfig {
  keyPrefix?: string;
  memoryMaxEntries?: number;
  preferredBackend?: "api" | "redis" | "disk" | "memory";
  apiBaseUrl?: string;
  circuitBreakerName?: string;
}

export function isApiCacheAvailable(): boolean {
  const proxyMode = getEnv("PROXY_MODE");
  const nodeEnv = getEnv("NODE_ENV");
  const apiUrl = getHostEnv("VERYFRONT_API_BASE_URL");

  const isProduction = proxyMode === "1" ||
    nodeEnv === "production" ||
    !!(apiUrl && !apiUrl.includes("localhost"));

  return isProduction && !!apiUrl;
}

export function isDiskCacheConfigured(): boolean {
  return getEnv("VF_CACHE_BACKEND") === "disk" || !!getEnv("VF_DISK_CACHE_DIR");
}

/**
 * Whether a local dev server must keep compiled code on disk.
 *
 * A local dev server has no hosted API cache and no Redis, so its code caches
 * live in memory and every restart recompiles the whole import tree. The disk
 * backend keeps that work under the project cache directory, so a restart
 * stays warm with no setup.
 *
 * This never changes a hosted or production runtime: the API and Redis
 * backends are resolved first, an explicit `VF_CACHE_BACKEND` always wins, and
 * anything other than a development environment keeps its current backend.
 */
export function isLocalDevDiskCacheEnabled(): boolean {
  if (getEnv("VF_CACHE_BACKEND") || isDiskCacheConfigured()) return false;
  return isDevelopment() && !isApiCacheAvailable() && !isRedisConfigured();
}

/**
 * Whether this runtime has a cache that outlives the process.
 *
 * Servers use this to decide whether to run the distributed-cache
 * initializers at startup. Without initialization the SSR module cache stays
 * disabled and the loader skips both reads and writes, so a gate that only
 * checks the explicit disk configuration leaves the local dev cache inert.
 */
export function isPersistentLocalCacheEnabled(): boolean {
  return isDiskCacheConfigured() || isLocalDevDiskCacheEnabled();
}

/**
 * Backend preference for caches that hold compiled code.
 *
 * Returns `undefined` outside local dev so the normal API, Redis, disk, memory
 * resolution order applies unchanged.
 */
export function localDevCodeCacheBackend(): CacheBackendConfig["preferredBackend"] {
  const configured = getEnv("VF_CACHE_BACKEND");
  if (
    configured === "api" || configured === "redis" || configured === "disk" ||
    configured === "memory"
  ) {
    return configured;
  }
  return isLocalDevDiskCacheEnabled() ? "disk" : undefined;
}

export function createCacheBackend(config: CacheBackendConfig = {}): Promise<CacheBackend> {
  const {
    keyPrefix = "",
    memoryMaxEntries = DEFAULT_MEMORY_MAX_ENTRIES,
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
        logger.debug("Using API backend (centralized cache)");
        span?.setAttribute("cache.backend.type", "api");
        return new ApiCacheBackend({ keyPrefix, apiBaseUrl, circuitBreakerName });
      }

      const shouldUseRedis = preferredBackend === "redis" ||
        (!preferredBackend && isRedisConfigured());
      if (shouldUseRedis) {
        const redisBackend = new RedisCacheBackend(keyPrefix ? `vf:${keyPrefix}:` : "vf:cache:");
        if (await redisBackend.initialize()) {
          logger.debug("Using Redis backend");
          span?.setAttribute("cache.backend.type", "redis");
          return redisBackend;
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
  return backend.type !== "memory";
}

const DISTRIBUTED_CACHE_RETRY_MS = 30_000;
const MAX_DISTRIBUTED_CACHE_SCOPES = 128;

interface DistributedCacheAccessorState {
  backend: CacheBackend | null | undefined;
  lastFailureTime: number;
  inflight: Promise<CacheBackend | null> | null;
}

export function createDistributedCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
  getScopeKey?: () => string,
): () => Promise<CacheBackend | null> {
  const states = new Map<string, DistributedCacheAccessorState>();

  return () => {
    const scopeKey = getScopeKey?.() ?? "";
    let state = states.get(scopeKey);
    if (!state) {
      if (states.size >= MAX_DISTRIBUTED_CACHE_SCOPES) {
        const settledScope = [...states].find(([, candidate]) => !candidate.inflight)?.[0];
        if (settledScope !== undefined) states.delete(settledScope);
      }
      state = { backend: undefined, lastFailureTime: 0, inflight: null };
      states.set(scopeKey, state);
    } else if (getScopeKey) {
      states.delete(scopeKey);
      states.set(scopeKey, state);
    }

    if (state.backend !== undefined) {
      if (
        state.backend === null && state.lastFailureTime > 0 &&
        Date.now() - state.lastFailureTime >= DISTRIBUTED_CACHE_RETRY_MS
      ) {
        state.backend = undefined;
        logger.debug(`[${name}] Retrying distributed cache initialization after failure`);
      }

      if (state.backend !== undefined) return Promise.resolve(state.backend);
    }

    if (!state.inflight) {
      state.inflight = (async () => {
        try {
          const b = await factory();
          if (!isDistributedBackend(b)) {
            state.backend = null;
            state.lastFailureTime = 0;
            logger.debug(`[${name}] No distributed cache available (memory only)`);
            return null;
          }

          state.backend = b;
          state.lastFailureTime = 0;
          logger.debug(`[${name}] Distributed cache initialized`, { type: b.type });
          return b;
        } catch (error) {
          logger.debug(`[${name}] Failed to initialize distributed cache`, { error });
          state.backend = null;
          state.lastFailureTime = Date.now();
          return null;
        }
      })().finally(() => {
        state.inflight = null;
      });
    }

    return state.inflight;
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
  // Holds compiled TSX/JSX modules, so it opts into local dev disk persistence.
  ssrModule: () =>
    createCacheBackend({
      keyPrefix: "ssr-module",
      preferredBackend: localDevCodeCacheBackend(),
    }),
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
  getScopeKey?: () => string,
): () => Promise<TokenizingCacheGateway | null> {
  const baseAccessor = createDistributedCacheAccessor(factory, name, getScopeKey);

  return async () => {
    const backend = await baseAccessor();
    if (!backend) return null;
    return createTokenizingGateway(backend, name);
  };
}

// Re-export createTokenizingGateway for convenience
export { createTokenizingGateway };
