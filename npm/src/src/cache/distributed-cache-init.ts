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

import { logger } from "../utils/logger/logger.js";
import { initializeTransformCache } from "../transforms/esm/transform-cache.js";
import { initializeSSRDistributedCache } from "../modules/react-loader/ssr-module-loader/index.js";
import { initializeFileCacheBackend } from "../platform/adapters/fs/cache/file-cache.js";
import { initializeProjectCSSCache } from "../html/styles-builder/tailwind-compiler.js";
import { isRedisConfigured } from "../utils/redis-client.js";
import { isApiCacheAvailable } from "./backend.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";

export interface DistributedCacheStatus {
  backend: "api" | "redis" | "memory";
  transformCache: boolean;
  ssrModuleCache: boolean;
  fileCache: boolean;
  projectCSSCache: boolean;
}

function determineBackend(): DistributedCacheStatus["backend"] {
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
      projectCSSCache: false,
    });
  }

  return withSpan(
    SpanNames.CACHE_DISTRIBUTED_INIT,
    async () => {
      logger.info("[DistributedCache] Initializing caches...", { backend });

      const [transformResult, ssrResult, fileResult, projectCSSResult] = await Promise.allSettled([
        initializeTransformCache(),
        initializeSSRDistributedCache(),
        initializeFileCacheBackend(),
        initializeProjectCSSCache(),
      ]);

      const status: DistributedCacheStatus = {
        backend,
        transformCache: wasSuccessful(transformResult),
        ssrModuleCache: wasSuccessful(ssrResult),
        fileCache: wasSuccessful(fileResult),
        projectCSSCache: wasSuccessful(projectCSSResult),
      };

      const enabled = [
        status.transformCache,
        status.ssrModuleCache,
        status.fileCache,
        status.projectCSSCache,
      ].filter(Boolean).length;

      if (enabled > 0) {
        logger.info("[DistributedCache] Initialization complete", {
          backend,
          enabled,
          transform: status.transformCache,
          ssrModule: status.ssrModuleCache,
          file: status.fileCache,
          projectCSS: status.projectCSSCache,
        });
      } else {
        logger.warn("[DistributedCache] No caches enabled despite backend being available", {
          backend,
        });
      }

      return status;
    },
    { "cache.backend": backend },
  );
}
