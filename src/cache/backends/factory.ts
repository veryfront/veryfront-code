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
import { ApiCacheBackend } from "./api.ts";
import { DiskCacheBackend } from "./disk.ts";
import { getEnvValue } from "./helpers.ts";
import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedRuntimeProvider,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import {
  buildDistributedCacheKeyPrefix,
  DistributedCacheNamespace,
  type DistributedCacheOwnershipMatcher,
  registerOwnedDistributedCacheNamespace,
} from "./distributed-keyspace.ts";

const logger = baseLogger.component("cache-backend");

const DEFAULT_MEMORY_MAX_ENTRIES = 500;

export type RuntimeCacheBackendSelection = "api" | "distributed" | "disk" | "memory";

export type { CodeCacheGateway, TokenizingCacheGateway };

export interface CacheBackendConfig {
  keyPrefix?: string;
  memoryMaxEntries?: number;
  preferredBackend?: "api" | "distributed" | "disk" | "memory";
  apiBaseUrl?: string;
  /** Maximum decoded JSON response body accepted from the API cache. */
  apiMaxResponseBytes?: number;
  /** Project identity bound to process-level API credentials. */
  projectRef?: string;
  circuitBreakerName?: string;
  /**
   * Exact parser for project ownership in a configured distributed namespace.
   * Without one, custom namespace keys are intentionally excluded from
   * project-scoped distributed listing and deletion.
   */
  distributedProjectOwnershipMatcher?: DistributedCacheOwnershipMatcher;
}

function isLocalDevelopmentApiUrl(value: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    // Let ApiCacheBackend report malformed configured URLs instead of silently
    // treating a typo as an unavailable cache.
    return false;
  }

  return hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "lvh.me" ||
    hostname.endsWith(".lvh.me") ||
    hostname === "0.0.0.0" ||
    hostname === "[::]" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function isApiCacheAvailable(): boolean {
  const proxyMode = getEnv("PROXY_MODE");
  const nodeEnv = getEnv("NODE_ENV");
  const apiUrl = getHostEnv("VERYFRONT_API_BASE_URL") ?? getEnvValue("VERYFRONT_API_BASE_URL");

  const isProduction = proxyMode === "1" ||
    nodeEnv === "production" ||
    !!(apiUrl && !isLocalDevelopmentApiUrl(apiUrl));

  return isProduction && !!apiUrl;
}

export function isDiskCacheConfigured(): boolean {
  return getEnv("VF_CACHE_BACKEND") === "disk" || !!getEnv("VF_DISK_CACHE_DIR");
}

/** Resolve and validate the process-level cache selection in one place. */
export function getRuntimeCacheBackendSelection(): RuntimeCacheBackendSelection {
  const selection = getEnv("VF_CACHE_BACKEND");
  if (
    selection !== undefined &&
    selection !== "api" &&
    selection !== "distributed" &&
    selection !== "disk" &&
    selection !== "memory"
  ) {
    throw new TypeError("VF_CACHE_BACKEND must be api, distributed, disk, or memory");
  }
  if (selection !== undefined) return selection;
  if (isApiCacheAvailable()) return "api";
  if (isDiskCacheConfigured()) return "disk";
  return "memory";
}

export function createCacheBackend(config: CacheBackendConfig = {}): Promise<CacheBackend> {
  const {
    keyPrefix = "",
    memoryMaxEntries = DEFAULT_MEMORY_MAX_ENTRIES,
    preferredBackend,
    apiBaseUrl,
    apiMaxResponseBytes,
    projectRef,
    circuitBreakerName,
    distributedProjectOwnershipMatcher,
  } = config;

  return withSpan(
    SpanNames.CACHE_BACKEND_CREATE,
    async (span?: Span) => {
      const environmentSelection = preferredBackend === undefined
        ? getRuntimeCacheBackendSelection()
        : undefined;
      const selectedBackend = preferredBackend ?? environmentSelection;
      const shouldUseApi = selectedBackend === "api";
      if (shouldUseApi) {
        logger.debug("Using API backend (centralized cache)");
        span?.setAttribute("cache.backend.type", "api");
        return new ApiCacheBackend({
          keyPrefix,
          apiBaseUrl,
          maxResponseBytes: apiMaxResponseBytes,
          circuitBreakerName,
          projectRef,
        });
      }

      const shouldUseDistributed = selectedBackend === "distributed";
      if (shouldUseDistributed) {
        const distributedKeyPrefix = buildDistributedCacheKeyPrefix(keyPrefix);
        registerOwnedDistributedCacheNamespace({
          prefix: distributedKeyPrefix,
          matchProjectOwnership: distributedProjectOwnershipMatcher,
        });
        const provider = captureDistributedRuntimeProvider(
          resolveExtensionContract<DistributedRuntimeProvider>(
            DistributedRuntimeProviderName,
          ),
        );
        const distributedBackend = await provider.createCacheBackend({
          keyPrefix: distributedKeyPrefix,
        });
        if (!distributedBackend || distributedBackend.type !== "distributed") {
          throw new TypeError(
            `${DistributedRuntimeProviderName} returned an invalid distributed cache backend`,
          );
        }
        logger.debug("Using distributed cache backend", { provider: provider.id });
        span?.setAttribute("cache.backend.type", "distributed");
        span?.setAttribute("cache.backend.provider", provider.id);
        return distributedBackend;
      }

      const shouldUseDisk = selectedBackend === "disk";
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
  return backend.type === "distributed" || backend.type === "api";
}

export function createDistributedCacheAccessor(
  factory: () => Promise<CacheBackend>,
  name: string,
): () => Promise<CacheBackend | null> {
  let backend: CacheBackend | null | undefined;
  let inflight: Promise<CacheBackend | null> | null = null;

  return () => {
    if (backend !== undefined) return Promise.resolve(backend);

    if (!inflight) {
      inflight = (async () => {
        const candidate = await factory();
        if (!isDistributedBackend(candidate)) {
          backend = null;
          logger.debug(`[${name}] Distributed cache is not selected`);
          return null;
        }
        backend = candidate;
        logger.debug(`[${name}] Distributed cache initialized`, { type: candidate.type });
        return candidate;
      })().finally(() => {
        inflight = null;
      });
    }

    return inflight;
  };
}

export const CacheBackends = {
  transform: () => createCacheBackend({ keyPrefix: DistributedCacheNamespace.TRANSFORM }),
  file: () => createCacheBackend(),
  module: () => createCacheBackend({ keyPrefix: DistributedCacheNamespace.MODULE }),
  render: () => createCacheBackend({ keyPrefix: DistributedCacheNamespace.RENDER }),
  userKv: () => createCacheBackend({ keyPrefix: "kv", preferredBackend: "api" }),
  httpModule: () =>
    createCacheBackend({
      keyPrefix: DistributedCacheNamespace.HTTP_MODULE,
      circuitBreakerName: "api-cache-http",
    }),
  ssrModule: () => createCacheBackend({ keyPrefix: DistributedCacheNamespace.SSR_MODULE }),
  projectCSS: () => createCacheBackend({ keyPrefix: DistributedCacheNamespace.PROJECT_CSS }),

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

export { createTokenizingGateway };
