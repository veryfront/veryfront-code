import { initializeFileCacheBackend } from "#veryfront/platform/adapters/fs/cache/file-cache.ts";
import { initializeSSRDistributedCache } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { initializeTransformCache } from "#veryfront/transforms/esm/transform-cache.ts";
import { initializeHttpModuleDistributedCache } from "#veryfront/transforms/esm/http-cache-wrapper.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { initializeProjectCSSCache } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { isRedisConfigured } from "#veryfront/utils/redis-client.ts";
import { isApiCacheAvailable, isDiskCacheConfigured } from "./backend.ts";

const logger = baseLogger.component("distributed-cache");

interface DistributedCacheStatus {
  backend: "api" | "redis" | "disk" | "memory";
  transformCache: boolean;
  ssrModuleCache: boolean;
  fileCache: boolean;
  projectCSSCache: boolean;
  httpModuleCache: boolean;
}

type DistributedCacheInitializers = {
  transformCache: () => Promise<boolean>;
  ssrModuleCache: () => Promise<boolean>;
  fileCache: () => Promise<boolean>;
  projectCSSCache: () => Promise<boolean>;
  httpModuleCache: () => Promise<boolean>;
};

const defaultInitializers: DistributedCacheInitializers = {
  transformCache: initializeTransformCache,
  ssrModuleCache: initializeSSRDistributedCache,
  fileCache: initializeFileCacheBackend,
  projectCSSCache: initializeProjectCSSCache,
  httpModuleCache: initializeHttpModuleDistributedCache,
};

function determineBackend(): DistributedCacheStatus["backend"] {
  if (isApiCacheAvailable()) return "api";
  if (isRedisConfigured()) return "redis";
  if (isDiskCacheConfigured()) return "disk";
  return "memory";
}

function wasSuccessful(result: PromiseSettledResult<boolean>): boolean {
  return result.status === "fulfilled" && result.value;
}

async function initializeDistributedCachesWithInitializers(
  backend: DistributedCacheStatus["backend"],
  initializers: DistributedCacheInitializers,
): Promise<DistributedCacheStatus> {
  logger.info("Initializing caches...", { backend });

  const cacheNames = [
    "transformCache",
    "ssrModuleCache",
    "fileCache",
    "projectCSSCache",
    "httpModuleCache",
  ] as const;
  const results = await Promise.allSettled([
    initializers.transformCache(),
    initializers.ssrModuleCache(),
    initializers.fileCache(),
    initializers.projectCSSCache(),
    initializers.httpModuleCache(),
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
    httpModuleCache: wasSuccessful(results[4]),
  };

  const enabled = [
    status.transformCache,
    status.ssrModuleCache,
    status.fileCache,
    status.projectCSSCache,
    status.httpModuleCache,
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
    httpModule: status.httpModuleCache,
  });

  return status;
}

export function __runDistributedCacheInitializationForTests(
  backend: DistributedCacheStatus["backend"],
  initializers: DistributedCacheInitializers,
): Promise<DistributedCacheStatus> {
  return initializeDistributedCachesWithInitializers(backend, initializers);
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
      httpModuleCache: false,
    });
  }

  return withSpan(
    SpanNames.CACHE_DISTRIBUTED_INIT,
    () => initializeDistributedCachesWithInitializers(backend, defaultInitializers),
    { "cache.backend": backend },
  );
}
