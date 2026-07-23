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
import { CACHE_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

const logger = baseLogger.component("cache-backend");

const DEFAULT_MEMORY_MAX_ENTRIES = 500;
const MAX_MEMORY_MAX_ENTRIES = 1_000_000;
const MAX_KEY_PREFIX_LENGTH = 512;
const MAX_API_BASE_URL_LENGTH = 2048;
const MAX_CIRCUIT_BREAKER_NAME_LENGTH = 128;
const MAX_ACCESSOR_NAME_LENGTH = 128;

// Re-export gateway types for backward compatibility
export type { CodeCacheGateway, TokenizingCacheGateway };

export interface CacheBackendConfig {
  keyPrefix?: string;
  memoryMaxEntries?: number;
  preferredBackend?: "api" | "redis" | "disk" | "memory";
  apiBaseUrl?: string;
  circuitBreakerName?: string;
}

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function readConfig(config: object, key: keyof CacheBackendConfig): unknown {
  try {
    return Reflect.get(config, key);
  } catch {
    invalidArgument("Cache backend configuration must be readable");
  }
}

function normalizeOptionalString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maxLength || containsUnsafeCacheStringCharacter(value)
  ) {
    invalidArgument(
      `${label} must be a bounded string without control characters or unpaired UTF-16 surrogates`,
    );
  }
  return value;
}

function normalizeConfig(value: unknown):
  & Required<
    Pick<CacheBackendConfig, "keyPrefix" | "memoryMaxEntries">
  >
  & Omit<CacheBackendConfig, "keyPrefix" | "memoryMaxEntries"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidArgument("Cache backend configuration must be an object");
  }
  const config = value as object;
  const preferredBackend = readConfig(config, "preferredBackend");
  if (
    preferredBackend !== undefined && preferredBackend !== "api" &&
    preferredBackend !== "redis" && preferredBackend !== "disk" &&
    preferredBackend !== "memory"
  ) {
    invalidArgument("Preferred cache backend is not supported");
  }

  const memoryMaxEntries = readConfig(config, "memoryMaxEntries") ?? DEFAULT_MEMORY_MAX_ENTRIES;
  if (
    typeof memoryMaxEntries !== "number" || !Number.isSafeInteger(memoryMaxEntries) ||
    memoryMaxEntries < 1 || memoryMaxEntries > MAX_MEMORY_MAX_ENTRIES
  ) {
    invalidArgument("Memory cache entry capacity must be a positive safe integer");
  }

  return Object.freeze({
    keyPrefix: normalizeOptionalString(
      readConfig(config, "keyPrefix") ?? "",
      "Cache key prefix",
      MAX_KEY_PREFIX_LENGTH,
      true,
    )!,
    memoryMaxEntries,
    preferredBackend,
    apiBaseUrl: normalizeOptionalString(
      readConfig(config, "apiBaseUrl"),
      "API cache base URL",
      MAX_API_BASE_URL_LENGTH,
    ),
    circuitBreakerName: normalizeOptionalString(
      readConfig(config, "circuitBreakerName"),
      "Cache circuit breaker name",
      MAX_CIRCUIT_BREAKER_NAME_LENGTH,
    ),
  });
}

function assertAccessorInputs(
  factory: unknown,
  name: unknown,
): asserts factory is () => Promise<CacheBackend> {
  if (typeof factory !== "function") invalidArgument("Cache backend factory must be a function");
  if (
    typeof name !== "string" || name.length === 0 || name.length > MAX_ACCESSOR_NAME_LENGTH ||
    containsUnsafeCacheStringCharacter(name)
  ) {
    invalidArgument(
      "Cache accessor name must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }
}

export function isApiCacheAvailable(): boolean {
  const proxyMode = getEnv("PROXY_MODE");
  const nodeEnv = getEnv("NODE_ENV");
  const apiUrl = getHostEnv("VERYFRONT_API_BASE_URL") ?? getEnvValue("VERYFRONT_API_BASE_URL");

  let isRemoteApi = false;
  if (apiUrl) {
    try {
      const hostname = new URL(apiUrl).hostname.toLowerCase();
      isRemoteApi = hostname !== "localhost" && hostname !== "127.0.0.1" &&
        hostname !== "::1" && hostname !== "lvh.me" &&
        !hostname.endsWith(".localhost") && !hostname.endsWith(".lvh.me");
    } catch {
      return false;
    }
  }

  const isProduction = proxyMode === "1" || nodeEnv === "production" || isRemoteApi;

  return isProduction && !!apiUrl;
}

export function isDiskCacheConfigured(): boolean {
  return getEnv("VF_CACHE_BACKEND") === "disk" || !!getEnv("VF_DISK_CACHE_DIR");
}

export async function createCacheBackend(config: CacheBackendConfig = {}): Promise<CacheBackend> {
  const normalizedConfig = normalizeConfig(config);
  const {
    keyPrefix = "",
    memoryMaxEntries = DEFAULT_MEMORY_MAX_ENTRIES,
    preferredBackend,
    apiBaseUrl,
    circuitBreakerName,
  } = normalizedConfig;

  return await withSpan(
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
        if (preferredBackend === "redis" && !isRedisConfigured()) {
          throw CACHE_ERROR.create({ detail: "The configured Redis cache is unavailable" });
        }
        const redisBackend = new RedisCacheBackend(keyPrefix ? `vf:${keyPrefix}:` : "vf:cache:");
        if (await redisBackend.initialize()) {
          logger.debug("Using Redis backend");
          span?.setAttribute("cache.backend.type", "redis");
          return redisBackend;
        }
        if (preferredBackend === "redis") {
          throw CACHE_ERROR.create({ detail: "The configured Redis cache could not initialize" });
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
      "cache.preferred_backend": preferredBackend ?? "auto",
    },
  );
}

export function isDistributedBackend(backend: CacheBackend): boolean {
  return backend.type === "api" || backend.type === "redis" || backend.type === "disk";
}

const DISTRIBUTED_CACHE_RETRY_MS = 30_000;

export function createDistributedCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
): () => Promise<CacheBackend | null> {
  assertAccessorInputs(factory, name);
  let backend: CacheBackend | null | undefined;
  let lastFailureTime = 0;

  let inflight: Promise<CacheBackend | null> | null = null;

  return () => {
    if (backend !== undefined) {
      if (
        backend === null && lastFailureTime > 0 &&
        Date.now() - lastFailureTime >= DISTRIBUTED_CACHE_RETRY_MS
      ) {
        backend = undefined;
        logger.debug("Retrying distributed cache initialization after failure");
      }

      if (backend !== undefined) return Promise.resolve(backend);
    }

    if (!inflight) {
      inflight = (async () => {
        try {
          const b = await factory();
          if (!isDistributedBackend(b)) {
            backend = null;
            lastFailureTime = 0;
            logger.debug("No distributed cache available (memory only)");
            return null;
          }

          backend = b;
          lastFailureTime = 0;
          logger.debug("Distributed cache initialized", { type: b.type });
          return b;
        } catch (error) {
          logger.debug("Failed to initialize distributed cache", {
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

export const CacheBackends = Object.freeze({
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
});

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
