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
import { isApiCacheAvailable } from "./backend.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

export interface DistributedCacheStatus {
  backend: "api" | "redis" | "memory";
  transformCache: boolean;
  ssrModuleCache: boolean;
  fileCache: boolean;
}

function determineBackend(): "api" | "redis" | "memory" {
  if (isApiCacheAvailable()) return "api";
  if (isRedisConfigured()) return "redis";
  return "memory";
}

function wasSuccessful(result: PromiseSettledResult<boolean>): boolean {
  return result.status === "fulfilled" && result.value;
}

/**
 * Initialize all distributed caches.
 *
 * This function is idempotent and safe to call multiple times.
 * Each cache will only initialize once.
 *
 * @returns Status object indicating which caches were enabled
 */
export function initializeDistributedCaches(): Promise<DistributedCacheStatus> {
  const backend = determineBackend();

  if (backend === "memory") {
    return Promise.resolve({
      backend,
      transformCache: false,
      ssrModuleCache: false,
      fileCache: false,
    });
  }

  return withSpan(
    SpanNames.CACHE_DISTRIBUTED_INIT,
    async () => {
      logger.info("[DistributedCache] Initializing caches...", { backend });

      const [transformResult, ssrResult, fileResult] = await Promise.allSettled([
        initializeTransformCache(),
        initializeSSRDistributedCache(),
        initializeFileCacheBackend(),
      ]);

      const status: DistributedCacheStatus = {
        backend,
        transformCache: wasSuccessful(transformResult),
        ssrModuleCache: wasSuccessful(ssrResult),
        fileCache: wasSuccessful(fileResult),
      };

      const enabledCount = [status.transformCache, status.ssrModuleCache, status.fileCache]
        .filter(Boolean).length;

      if (enabledCount > 0) {
        logger.info("[DistributedCache] Initialization complete", {
          backend,
          enabled: enabledCount,
          transform: status.transformCache,
          ssrModule: status.ssrModuleCache,
          file: status.fileCache,
        });
      } else {
        logger.warn("[DistributedCache] No caches enabled despite backend being available", {
          backend,
        });
      }

      return status;
    },
    {
      "cache.backend": backend,
    },
  );
}
