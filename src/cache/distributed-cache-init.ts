import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { isRedisConfigured } from "#veryfront/utils/redis-client.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { isApiCacheAvailable, isDiskCacheConfigured } from "./backend.ts";

const logger = baseLogger.component("distributed-cache");
const DISTRIBUTED_CACHE_INITIALIZATION_TIMEOUT_MS = 30_000;

/** Result of initializing each distributed cache integration. */
export interface DistributedCacheStatus {
  /** Backend selected from the current runtime configuration. */
  backend: "api" | "redis" | "disk" | "memory";
  /** Whether the transform cache initialized successfully. */
  transformCache: boolean;
  /** Whether the SSR module cache initialized successfully. */
  ssrModuleCache: boolean;
  /** Whether the file cache initialized successfully. */
  fileCache: boolean;
  /** Whether the project CSS cache initialized successfully. */
  projectCSSCache: boolean;
  /** Whether the HTTP module cache initialized successfully. */
  httpModuleCache: boolean;
}

/**
 * Per-cache initialization functions, injected by the composition root.
 *
 * The concrete initializers live in higher layers (`transforms`, `modules`,
 * `html`, `platform`). They are passed in rather than imported here so that
 * `src/cache` stays a low-level layer that does not depend on the rendering /
 * transform / platform layers it would otherwise have to reach up into. See
 * `src/server/distributed-cache-initializers.ts` for the default wiring.
 */
export type DistributedCacheInitializers = {
  /** Initialize transformed-module caching. */
  transformCache: (signal: AbortSignal) => Promise<boolean>;
  /** Initialize SSR module caching. */
  ssrModuleCache: (signal: AbortSignal) => Promise<boolean>;
  /** Initialize filesystem response caching. */
  fileCache: (signal: AbortSignal) => Promise<boolean>;
  /** Initialize project CSS caching. */
  projectCSSCache: (signal: AbortSignal) => Promise<boolean>;
  /** Initialize HTTP module caching. */
  httpModuleCache: (signal: AbortSignal) => Promise<boolean>;
};

function determineBackend(): DistributedCacheStatus["backend"] {
  if (isApiCacheAvailable()) return "api";
  if (isRedisConfigured()) return "redis";
  if (isDiskCacheConfigured()) return "disk";
  return "memory";
}

function wasSuccessful(result: PromiseSettledResult<boolean> | undefined): boolean {
  return result?.status === "fulfilled" && result.value === true;
}

function snapshotInitializer(
  initializers: DistributedCacheInitializers,
  name: keyof DistributedCacheInitializers,
): (signal: AbortSignal) => Promise<boolean> {
  try {
    const initializer = Reflect.get(initializers, name);
    if (typeof initializer === "function") {
      return (signal: AbortSignal) =>
        Reflect.apply(initializer, initializers, [signal]) as Promise<boolean>;
    }
  } catch {
    // Return a rejected task below so one unreadable initializer does not stop
    // the remaining independent caches from initializing.
  }

  return () =>
    Promise.reject(
      INITIALIZATION_ERROR.create({ detail: "Cache initializer is invalid or unreadable" }),
    );
}

function runInitializerWithTimeout(
  initialize: (signal: AbortSignal) => Promise<boolean>,
): Promise<boolean> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = INITIALIZATION_ERROR.create({
        detail: "Cache initialization exceeded the supported duration",
      });
      controller.abort(timeoutError);
      reject(timeoutError);
    }, DISTRIBUTED_CACHE_INITIALIZATION_TIMEOUT_MS);
  });

  return Promise.race([
    Promise.resolve().then(() => initialize(controller.signal)),
    timeout,
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
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
  const initializerTasks = cacheNames.map((name) => snapshotInitializer(initializers, name));
  const results = await Promise.allSettled(
    initializerTasks.map(runInitializerWithTimeout),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === "rejected") {
      logger.error(`Cache initialization failed: ${cacheNames[i]}`, {
        backend,
        errorName: result.reason instanceof Error ? result.reason.name : "UnknownError",
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

/**
 * Initialize the configured distributed cache integrations.
 *
 * Memory-only runtimes return a disabled status without invoking the supplied
 * initializers. Each distributed initializer is isolated and time-bounded.
 */
export function initializeDistributedCaches(
  initializers: DistributedCacheInitializers,
): Promise<DistributedCacheStatus> {
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
    () => initializeDistributedCachesWithInitializers(backend, initializers),
    { "cache.backend": backend },
  );
}
