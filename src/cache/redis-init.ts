/**
 * Distributed Cache Initialization
 *
 * Initializes all distributed caches for cross-pod cache sharing.
 * This reduces memory pressure on individual pods by offloading
 * cached data to a shared backend (API or Redis).
 *
 * Backend selection priority:
 * - API (production): Uses veryfront-api for centralized cache
 * - Redis (local dev/open source): Direct Redis access
 * - Memory (fallback): In-memory cache
 *
 * Call this at server startup.
 */

import { logger } from "../utils/logger/logger.ts";
import { initializeTransformCache } from "#veryfront/transforms/esm/transform-cache.ts";
import { initializeSSRDistributedCache } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { initializeFileCacheBackend } from "#veryfront/platform/adapters/fs/cache/file-cache.ts";
import { isRedisConfigured } from "../utils/redis-client.ts";
import { runtime } from "../platform/adapters/registry.ts";

export interface DistributedCacheStatus {
  backend: "api" | "redis" | "memory";
  transformCache: boolean;
  ssrModuleCache: boolean;
  fileCache: boolean;
}

/** @deprecated Use DistributedCacheStatus instead */
export type RedisCacheStatus = DistributedCacheStatus & { configured: boolean };

/** Check if API cache backend is available (proxy mode with API URL). */
function isApiCacheAvailable(): boolean {
  if (!runtime.isInitialized()) return false;
  const env = runtime.getSync().env;
  return env.get("PROXY_MODE") === "1" && !!env.get("VERYFRONT_API_BASE_URL");
}

/**
 * Initialize all distributed caches.
 *
 * This function is idempotent and safe to call multiple times.
 * Each cache will only initialize once.
 *
 * @returns Status object indicating which caches were enabled
 */
export async function initializeRedisCaches(): Promise<DistributedCacheStatus> {
  const hasApiCache = isApiCacheAvailable();
  const hasRedis = isRedisConfigured();

  const status: DistributedCacheStatus = {
    backend: hasApiCache ? "api" : hasRedis ? "redis" : "memory",
    transformCache: false,
    ssrModuleCache: false,
    fileCache: false,
  };

  if (!hasApiCache && !hasRedis) {
    logger.debug("[DistributedCache] No distributed backend available, using memory-only caches");
    return status;
  }

  logger.info("[DistributedCache] Initializing caches...", { backend: status.backend });

  // Initialize all caches in parallel
  const [transformResult, ssrResult, fileResult] = await Promise.allSettled([
    initializeTransformCache(),
    initializeSSRDistributedCache(),
    initializeFileCacheBackend(),
  ]);

  status.transformCache = transformResult.status === "fulfilled" && transformResult.value;
  status.ssrModuleCache = ssrResult.status === "fulfilled" && ssrResult.value;
  status.fileCache = fileResult.status === "fulfilled" && fileResult.value;

  const enabledCount = [status.transformCache, status.ssrModuleCache, status.fileCache]
    .filter(Boolean).length;

  if (enabledCount > 0) {
    logger.info("[DistributedCache] Initialization complete", {
      backend: status.backend,
      enabled: enabledCount,
      transform: status.transformCache,
      ssrModule: status.ssrModuleCache,
      file: status.fileCache,
    });
  } else {
    logger.warn("[DistributedCache] No caches enabled despite backend being available", {
      backend: status.backend,
    });
  }

  return status;
}
