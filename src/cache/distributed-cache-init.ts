import { initializeFileCacheBackend } from "#veryfront/platform/adapters/fs/cache/file-cache.ts";
import { initializeSSRDistributedCache } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { initializeTransformCache } from "#veryfront/transforms/esm/transform-cache.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { initializeProjectCSSCache } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { isRedisConfigured } from "#veryfront/utils/redis-client.ts";
import { isApiCacheAvailable, isDiskCacheConfigured } from "./backend.ts";

const logger = baseLogger.component("distributed-cache");

export interface DistributedCacheStatus {
  backend: "api" | "redis" | "disk" | "memory";
  transformCache: boolean;
  ssrModuleCache: boolean;
  fileCache: boolean;
  projectCSSCache: boolean;
}

function determineBackend(): DistributedCacheStatus["backend"] {
  if (isApiCacheAvailable()) return "api";
  if (isRedisConfigured()) return "redis";
  if (isDiskCacheConfigured()) return "disk";
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
      transformCache: false,
      ssrModuleCache: false,
      fileCache: false,
      projectCSSCache: false,
    });
  }

  return withSpan(
    SpanNames.CACHE_DISTRIBUTED_INIT,
    async (): Promise<DistributedCacheStatus> => {
      logger.info("Initializing caches...", { backend });

      const cacheNames = [
        "transformCache",
        "ssrModuleCache",
        "fileCache",
        "projectCSSCache",
      ] as const;
      const results = await Promise.allSettled([
        initializeTransformCache(),
        initializeSSRDistributedCache(),
        initializeFileCacheBackend(),
        initializeProjectCSSCache(),
      ]);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result && result.status === "rejected") {
          logger.error(`Cache initialization failed: ${cacheNames[i]}`, {
            backend,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }

      const status: DistributedCacheStatus = {
        backend,
        transformCache: wasSuccessful(results[0]),
        ssrModuleCache: wasSuccessful(results[1]),
        fileCache: wasSuccessful(results[2]),
        projectCSSCache: wasSuccessful(results[3]),
      };

      const enabled = [
        status.transformCache,
        status.ssrModuleCache,
        status.fileCache,
        status.projectCSSCache,
      ].filter(Boolean).length;

      if (enabled === 0) {
        logger.warn("No caches enabled despite backend being available", {
          backend,
        });
        return status;
      }

      logger.info("Initialization complete", {
        backend,
        enabled,
        transform: status.transformCache,
        ssrModule: status.ssrModuleCache,
        file: status.fileCache,
        projectCSS: status.projectCSSCache,
      });

      return status;
    },
    { "cache.backend": backend },
  );
}
