import { initializeFileCacheBackend } from "#veryfront/platform/adapters/fs/cache/file-cache.ts";
import { initializeSSRDistributedCache } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { initializeProjectCSSCache } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { logger } from "../utils/logger/logger.ts";
import { isRedisConfigured } from "../utils/redis-client.ts";
import { isApiCacheAvailable } from "./backend.ts";

export interface DistributedCacheStatus {
  backend: "api" | "redis" | "memory";
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

export function initializeDistributedCaches(): Promise<DistributedCacheStatus> {
  const backend = determineBackend();

  if (backend === "memory") {
    return Promise.resolve({
      backend,
      ssrModuleCache: false,
      fileCache: false,
      projectCSSCache: false,
    });
  }

  return withSpan(
    SpanNames.CACHE_DISTRIBUTED_INIT,
    async (): Promise<DistributedCacheStatus> => {
      logger.info("[DistributedCache] Initializing caches...", { backend });

      const results = await Promise.allSettled([
        initializeSSRDistributedCache(),
        initializeFileCacheBackend(),
        initializeProjectCSSCache(),
      ]);

      const status: DistributedCacheStatus = {
        backend,
        ssrModuleCache: wasSuccessful(results[0]),
        fileCache: wasSuccessful(results[1]),
        projectCSSCache: wasSuccessful(results[2]),
      };

      const enabled = Number(status.ssrModuleCache) +
        Number(status.fileCache) +
        Number(status.projectCSSCache);

      if (enabled === 0) {
        logger.warn("[DistributedCache] No caches enabled despite backend being available", {
          backend,
        });
        return status;
      }

      logger.info("[DistributedCache] Initialization complete", {
        backend,
        enabled,
        ssrModule: status.ssrModuleCache,
        file: status.fileCache,
        projectCSS: status.projectCSSCache,
      });

      return status;
    },
    { "cache.backend": backend },
  );
}
