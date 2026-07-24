import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createVeryfrontHandler } from "./runtime-handler/index.ts";
import {
  bootstrapLocalCliProxy,
  bootstrapProd,
  type BootstrapResult,
  createRetryableDisposer,
  validateProductionEnvironment,
} from "./bootstrap.ts";
import { cwd, onGlobalError, onSignal } from "#veryfront/platform/compat/process.ts";
import { isDebugEnabled } from "#veryfront/utils/constants/env.ts";
import { initializeOTLPWithApis, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  startConfiguredMemoryMonitoring,
  stopMemoryMonitoring,
} from "#veryfront/utils/memory/index.ts";
import { initializeDistributedCaches } from "#veryfront/cache/distributed-cache-init.ts";
import { defaultDistributedCacheInitializers } from "#veryfront/server/distributed-cache-initializers.ts";
import { getConfig } from "#veryfront/config";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import {
  buildPreparedCSSArtifactFromFiles,
  collectLocalProjectSourceFiles,
  readLocalProjectStylesheet,
} from "#veryfront/html/styles-builder/css-pregeneration.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { setServerInitialized } from "./handlers/monitoring/health.handler.ts";
import {
  gracefullyShutdownProductionServer,
  parseShutdownDrainTimeoutMs,
} from "./graceful-shutdown.ts";
import {
  clearSSRServerPort,
  disableSSRClientOnlyFetching,
  disableSSRFetchInterception,
  enableSSRClientOnlyFetching,
  enableSSRFetchInterception,
  setSSRServerPort,
} from "#veryfront/rendering/ssr-globals.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { ExclusiveProcessOwner } from "./process-ownership.ts";
import { HMRHandler } from "./handlers/preview/hmr.handler.ts";
import { ServerStartupCleanupError } from "./startup-cleanup-error.ts";

const serverLog = logger.component("server");
const globalLog = logger.component("global");

/** Default port when PORT / VERYFRONT_PORT env vars are not set */
const DEFAULT_SERVER_PORT = 3_000;

const productionServerOwnership = new ExclusiveProcessOwner("production server");

interface ReadinessOutcome {
  readonly status: "ready" | "failed";
  readonly error?: unknown;
}

/**
 * Generation-owned production readiness coordination.
 *
 * @internal Exported for lifecycle regression tests; not re-exported from the
 * public server barrel.
 */
export interface ProductionReadiness {
  onListen(): void;
  cancel(error: unknown): void;
  ready(): Promise<void>;
}

/** @internal */
export function createProductionReadiness(
  handlerReady: Promise<void>,
): ProductionReadiness {
  setServerInitialized(false);
  const listenReady = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<ReadinessOutcome>();
  let active = true;

  const completed = Promise.all([listenReady.promise, handlerReady]).then(
    (): ReadinessOutcome => {
      if (!active) {
        return {
          status: "failed",
          error: new Error("Production server startup was cancelled before readiness"),
        };
      }
      setServerInitialized(true);
      return { status: "ready" };
    },
    (error: unknown): ReadinessOutcome => {
      setServerInitialized(false);
      return { status: "failed", error };
    },
  );
  const outcome = Promise.race([completed, cancelled.promise]);

  return {
    onListen(): void {
      if (active) listenReady.resolve();
    },
    cancel(error: unknown): void {
      if (!active) return;
      active = false;
      setServerInitialized(false);
      cancelled.resolve({ status: "failed", error });
    },
    ready(): Promise<void> {
      return outcome.then((result) => {
        if (result.status === "ready") return;
        throw result.error;
      });
    },
  };
}

async function prewarmLocalProductionCSSArtifacts(
  adapter: RuntimeAdapter,
  options: Pick<
    StartProductionServerOptions,
    | "projectDir"
    | "defaultProjectSlug"
    | "defaultProjectId"
    | "defaultEnvironment"
    | "localProjects"
  >,
): Promise<void> {
  if (options.defaultEnvironment !== "production") return;

  const projectsToWarm = new Map<string, string>();

  if (options.localProjects) {
    for (const [projectSlug, projectDir] of Object.entries(options.localProjects)) {
      projectsToWarm.set(projectSlug, projectDir);
    }
  }

  if (options.defaultProjectSlug && options.projectDir) {
    projectsToWarm.set(options.defaultProjectSlug, options.projectDir);
  } else if (projectsToWarm.size === 0 && options.defaultProjectId && options.projectDir) {
    projectsToWarm.set(options.defaultProjectId, options.projectDir);
  }

  if (projectsToWarm.size === 0) return;

  await Promise.all([...projectsToWarm.entries()].map(async ([projectSlug, projectDir]) => {
    try {
      const config = await getConfig(projectDir, adapter, { cacheKey: projectSlug });
      const styleProfile = createStyleScopeProfile(config);
      const files = await collectLocalProjectSourceFiles({
        projectDir,
        styleProfile,
      });
      const stylesheet = await readLocalProjectStylesheet(projectDir, config?.tailwind?.stylesheet);

      const result = await buildPreparedCSSArtifactFromFiles({
        projectSlug,
        projectVersion: resolveStyleContentVersion(null),
        projectDir,
        files,
        styleProfile,
        stylesheet,
        stylesheetPath: config?.tailwind?.stylesheet,
        minify: true,
        environment: "preview",
        buildMode: "production",
      });

      serverLog.debug("Prewarmed local production CSS artifact", {
        projectSlug,
        projectDir,
        fileCount: files.length,
        fromCache: result.fromCache,
      });
    } catch (error) {
      serverLog.debug("Skipping local production CSS prewarm", {
        projectSlug,
        projectDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
}

/** Configuration for AI primitives discovery during server startup */
export interface DiscoveryOptions {
  baseDir: string;
  fsAdapter?: FileSystemAdapter;
  /** For multi-project proxy mode: project slug for context scoping */
  projectSlug?: string;
  /** For multi-project proxy mode: API token for context scoping */
  apiToken?: string;
  verbose?: boolean;
}

interface ServerOptions {
  projectDir: string;
  port: number;
  /** 0.0.0.0 = all interfaces, 127.0.0.1 = localhost only */
  bindAddress?: string;
  signal?: AbortSignal;
  /** Default project slug when not provided via proxy headers (for tests/local mode) */
  defaultProjectSlug?: string;
  /** Default project ID when not provided via proxy headers (for tests/local mode) */
  defaultProjectId?: string;
  /** Default release ID when not provided via proxy headers (for standalone production mode) */
  defaultReleaseId?: string;
  /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
  defaultEnvironment?: "preview" | "production";
  /**
   * Optional request interceptor for combined mode.
   * Transforms requests before they're processed by the core request handler.
   * Used by proxy middleware to inject context headers in combined mode.
   */
  requestInterceptor?: (req: Request) => Request | Promise<Request>;
  /** Discovery configuration for AI primitives. Runs discoverAll() before serving. */
  discoveryConfig?: DiscoveryOptions;
  /** Map of project slugs to their filesystem paths (seeds local project discovery). */
  localProjects?: Record<string, string>;
}

/** Public API contract for server handle. */
export interface ServerHandle {
  /** Resolves after both the HTTP listener and request handler are ready. */
  ready: Promise<void>;
  /** Actual bound port. This differs from the requested value when port 0 is used. */
  readonly port: number;
  /**
   * Stop the listener and release all owned resources. Concurrent calls share
   * an attempt; call again to retry a rejected cleanup.
   */
  stop: () => Promise<void>;
}

/** Options accepted by start production server. */
export interface StartProductionServerOptions extends ServerOptions {
  debug?: boolean;
  adapter?: RuntimeAdapter;
  /**
   * Pre-computed bootstrap result to skip internal bootstrap. Ownership is
   * transferred to the returned handle; callers must not dispose it directly.
   * Public startup still enforces hosted-environment validation.
   */
  bootstrapResult?: BootstrapResult;
}

type ProductionBootstrap = (
  projectDir: string,
  adapter: RuntimeAdapter,
) => Promise<BootstrapResult>;

/**
 * Select or create the bootstrap generation owned by a production server.
 *
 * This helper does not establish startup trust. The server entrypoint must
 * snapshot and validate any supplied result before calling it.
 *
 * @internal Exported for bootstrap-selection regression tests.
 */
export function resolveProductionBootstrap(
  options: Pick<
    StartProductionServerOptions,
    "projectDir" | "bootstrapResult"
  >,
  adapter: RuntimeAdapter,
  bootstrap: ProductionBootstrap = bootstrapProd,
): Promise<BootstrapResult> {
  return options.bootstrapResult
    ? Promise.resolve(options.bootstrapResult)
    : bootstrap(options.projectDir, adapter);
}

const LOCAL_CLI_PROXY_SERVER_AUTHORIZATION = Symbol(
  "veryfront.local-cli-proxy-server",
);

type ProductionServerAuthorization =
  | typeof LOCAL_CLI_PROXY_SERVER_AUTHORIZATION
  | undefined;

function bootstrapForAuthorization(
  authorization: ProductionServerAuthorization,
): ProductionBootstrap {
  return authorization === LOCAL_CLI_PROXY_SERVER_AUTHORIZATION
    ? bootstrapLocalCliProxy
    : bootstrapProd;
}

async function startProductionServerWithAuthorization(
  options: StartProductionServerOptions,
  authorization: ProductionServerAuthorization,
): Promise<ServerHandle> {
  // Snapshot every caller-controlled option before acquiring process ownership.
  // Getters therefore cannot strand a live ownership generation, and later
  // mutation cannot swap in an unvalidated bootstrap or inconsistent settings.
  const {
    projectDir,
    port,
    bindAddress = "0.0.0.0",
    signal,
    debug,
    defaultProjectSlug,
    defaultProjectId,
    defaultReleaseId,
    defaultEnvironment,
    requestInterceptor,
    discoveryConfig,
    localProjects,
    adapter: requestedAdapter,
    bootstrapResult: suppliedBootstrap,
  } = options;
  const isAuthorizedLocalProxy = authorization === LOCAL_CLI_PROXY_SERVER_AUTHORIZATION;

  // A supplied result skips bootstrapProd(), so the public path must perform
  // the hosted validation here. The exact private symbol is the only bypass.
  if (suppliedBootstrap && !isAuthorizedLocalProxy) {
    validateProductionEnvironment();
  }

  const productionBootstrap = bootstrapForAuthorization(authorization);

  return await withSpan(
    "server.startProductionServer",
    async () => {
      const releaseServerOwnership = productionServerOwnership.acquire();
      setServerInitialized(false);
      let activeBootstrap: BootstrapResult | undefined;
      let readiness: ProductionReadiness | undefined;
      let ownsMemoryMonitoring = false;
      let memoryMonitoringStopped = true;
      let releaseHmrLifecycleOwner: (() => Promise<void>) | undefined;
      let hmrLifecycleReleased = true;
      let bootstrapDisposed = true;
      let serverOwnershipReleased = false;
      let listeningPort = port;
      let ssrPortInstalledValue: number | undefined;
      let ssrFetchInstalled = false;
      let ssrClientOnlyInstalled = false;

      const installSSRPort = (port: number): void => {
        if (ssrPortInstalledValue === port) return;
        if (ssrPortInstalledValue !== undefined) {
          clearSSRServerPort(ssrPortInstalledValue);
        }
        setSSRServerPort(port);
        ssrPortInstalledValue = port;
      };

      const releaseSSRRuntime = (): void => {
        const failures: unknown[] = [];
        if (ssrClientOnlyInstalled) {
          try {
            disableSSRClientOnlyFetching();
            ssrClientOnlyInstalled = false;
          } catch (error) {
            failures.push(error);
          }
        }
        if (ssrFetchInstalled) {
          try {
            disableSSRFetchInterception();
            ssrFetchInstalled = false;
          } catch (error) {
            failures.push(error);
          }
        }
        if (ssrPortInstalledValue !== undefined) {
          try {
            clearSSRServerPort(ssrPortInstalledValue);
            ssrPortInstalledValue = undefined;
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, "Failed to release production SSR runtime state");
        }
      };

      const cleanupOwnedResources = createRetryableDisposer(async () => {
        const failures: unknown[] = [];

        if (!memoryMonitoringStopped) {
          try {
            stopMemoryMonitoring();
            memoryMonitoringStopped = true;
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          releaseSSRRuntime();
        } catch (error) {
          failures.push(error);
        }
        if (!hmrLifecycleReleased) {
          try {
            await releaseHmrLifecycleOwner?.();
            hmrLifecycleReleased = true;
          } catch (error) {
            failures.push(error);
          }
        }
        if (!bootstrapDisposed) {
          try {
            await activeBootstrap?.dispose?.();
            bootstrapDisposed = true;
          } catch (error) {
            failures.push(error);
          }
        }

        if (failures.length > 0) {
          throw new AggregateError(failures, "Production server resource cleanup failed");
        }
        if (!serverOwnershipReleased) {
          releaseServerOwnership();
          serverOwnershipReleased = true;
        }
      });

      try {
        const baseAdapter = requestedAdapter ?? suppliedBootstrap?.adapter ??
          (await runtime.get());
        const memoryMonitoringConfig = startConfiguredMemoryMonitoring(baseAdapter.env);
        ownsMemoryMonitoring = memoryMonitoringConfig.enabled;
        memoryMonitoringStopped = !ownsMemoryMonitoring;

        // Use pre-computed bootstrap result if provided, otherwise bootstrap here
        activeBootstrap = await resolveProductionBootstrap(
          { projectDir, bootstrapResult: suppliedBootstrap },
          baseAdapter,
          productionBootstrap,
        );
        bootstrapDisposed = false;
        const bootstrap = activeBootstrap;
        const adapter = bootstrap.adapter;
        releaseHmrLifecycleOwner = HMRHandler.registerLifecycleOwner();
        hmrLifecycleReleased = false;

        if (bootstrap.usingFSAdapter) {
          logger.debug("FSAdapter initialized", { type: bootstrap.fsAdapterType });
        }

        await prewarmLocalProductionCSSArtifacts(bootstrap.adapter, {
          projectDir,
          defaultProjectSlug,
          defaultProjectId,
          defaultEnvironment,
          localProjects,
        });

        // Enable SSR fetch interception to handle relative URLs during SSR
        installSSRPort(port);
        enableSSRFetchInterception();
        ssrFetchInstalled = true;

        // Enable client-only fetching for /api/* routes in production.
        // This returns empty mock responses during SSR (instead of failing with
        // "Invalid URL" or "Connection refused"). React Query will refetch
        // the actual data client-side after hydration.
        enableSSRClientOnlyFetching();
        ssrClientOnlyInstalled = true;

        // Run primitive discovery before serving (registries must be populated before first request)
        if (discoveryConfig) {
          try {
            const { discoverAll } = await import("#veryfront/discovery");
            const { isExtendedFSAdapter } = await import(
              "#veryfront/platform/adapters/fs/wrapper.ts"
            );

            if (
              discoveryConfig.projectSlug && discoveryConfig.apiToken &&
              discoveryConfig.fsAdapter && isExtendedFSAdapter(discoveryConfig.fsAdapter) &&
              discoveryConfig.fsAdapter.isMultiProjectMode()
            ) {
              // Multi-project proxy: scope discovery to specific project
              await discoveryConfig.fsAdapter.runWithContext(
                discoveryConfig.projectSlug,
                discoveryConfig.apiToken,
                () =>
                  discoverAll({
                    baseDir: discoveryConfig.baseDir,
                    fsAdapter: discoveryConfig.fsAdapter,
                    verbose: discoveryConfig.verbose ?? false,
                  }),
                undefined,
                { tokenProvenance: "project-bound" },
              );
            } else {
              await discoverAll({
                baseDir: discoveryConfig.baseDir,
                fsAdapter: discoveryConfig.fsAdapter,
                verbose: discoveryConfig.verbose ?? false,
              });
            }
          } catch (error) {
            serverLog.error("Primitive discovery failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }

        logger.info("Starting production server", { projectDir, port, bindAddress });

        const baseHandler = createVeryfrontHandler(projectDir, adapter, {
          projectDir,
          debug,
          config: bootstrap.config,
          defaultProjectSlug,
          defaultProjectId,
          defaultReleaseId,
          defaultEnvironment,
          localProjects,
        });

        const coreHandler = baseHandler;

        // Wrap handler with interceptor if provided (for combined mode)
        // WebSocket upgrade requests MUST NOT be intercepted because the interceptor
        // creates a new Request object, which breaks Deno.upgradeWebSocket()
        const handler = requestInterceptor
          ? Object.assign(
            async (req: Request) => {
              const isWebSocketUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
              if (isWebSocketUpgrade) return coreHandler(req);
              return coreHandler(await requestInterceptor(req));
            },
            { ready: coreHandler.ready },
          )
          : coreHandler;

        readiness = createProductionReadiness(handler.ready ?? Promise.resolve());

        const server = await adapter.serve(handler, {
          port,
          hostname: bindAddress, // Deno uses "hostname" for bind address
          signal,
          onListen: (params) => {
            listeningPort = params.port;
            installSSRPort(params.port);
            readiness?.onListen();
            logger.info("Production server listening", params);
          },
        });
        listeningPort = server.addr.port;
        installSSRPort(listeningPort);

        let serverStopped = false;
        const stop = createRetryableDisposer(async () => {
          readiness?.cancel(new Error("Production server stopped before readiness"));

          if (!serverStopped) {
            await server.stop();
            serverStopped = true;
          }
          await cleanupOwnedResources();
        });

        const ready = readiness.ready().catch(async (error) => {
          try {
            await stop();
          } catch (disposeError) {
            throw new ServerStartupCleanupError(
              "Production handler readiness",
              error,
              disposeError,
              stop,
            );
          }
          throw error;
        });

        return { ready, stop, port: listeningPort };
      } catch (error) {
        readiness?.cancel(error);
        setServerInitialized(false);
        try {
          await cleanupOwnedResources();
        } catch (cleanupError) {
          throw new ServerStartupCleanupError(
            "Production server startup",
            error,
            cleanupError,
            cleanupOwnedResources,
          );
        }
        throw error;
      }
    },
    { "server.port": port, "server.bindAddress": bindAddress },
  );
}

/** Starts a normal hosted or standalone production server. */
export function startProductionServer(
  options: StartProductionServerOptions,
): Promise<ServerHandle> {
  return startProductionServerWithAuthorization(options, undefined);
}

/**
 * Starts the explicitly local CLI proxy through its private startup port.
 *
 * The authorization symbol never crosses the module boundary, so public
 * callers cannot manufacture the exemption through an options object.
 *
 * @internal
 */
export function startLocalCliProxyProductionServer(
  options: StartProductionServerOptions,
): Promise<ServerHandle> {
  return startProductionServerWithAuthorization(
    options,
    LOCAL_CLI_PROXY_SERVER_AUTHORIZATION,
  );
}

if (import.meta.main) {
  // Register global error handlers FIRST to prevent process crashes from application errors
  // This ensures the renderer stays up even if user code throws unhandled exceptions
  onGlobalError((error, type) => {
    // Fatal errors that indicate corrupted process state — let the process crash
    // so the orchestrator (k8s) can restart it cleanly
    // Stack overflow can be detected reliably via error.name + message.
    const isStackOverflow = error.name === "RangeError" &&
      error.message.includes("Maximum call stack");

    // OOM detection relies on V8/Deno message strings which are engine implementation
    // details (not standardized) and may change between versions. Treat as a best-effort
    // heuristic: if these strings change, OOM errors will be absorbed as non-fatal until
    // updated here. The OS / k8s OOMKiller will eventually terminate the process anyway.
    const isOOM = error.message.includes("out of memory") ||
      error.message.includes("allocation failed");

    const isFatal = isStackOverflow || isOOM;

    globalLog.error(`${type}: Application error caught`, {
      message: error.message,
      stack: error.stack,
      type,
      fatal: isFatal,
    });

    if (isFatal) {
      globalLog.error("Fatal error detected, allowing process exit for clean restart");
      return false;
    }

    // Non-fatal: prevent process exit — individual requests may fail but service stays up
    return true;
  });

  try {
    // Initialize OpenTelemetry tracing and distributed caches in parallel
    // Both can fail independently without blocking the other
    // Backend: API (production) > Redis (local dev) > Memory (fallback)
    const [otlpResult, cacheResult] = await Promise.allSettled([
      initializeOTLPWithApis(),
      initializeDistributedCaches(defaultDistributedCacheInitializers),
    ]);

    if (otlpResult.status === "rejected") {
      logger.warn("OTLP initialization failed, continuing without tracing", {
        error: otlpResult.reason,
      });
    }

    if (cacheResult.status === "rejected") {
      logger.warn("Distributed cache initialization failed, using memory fallback", {
        error: cacheResult.reason,
      });
    }

    const adapter = await runtime.get();

    const shutdownController = new AbortController();
    const projectDir = cwd();
    const port = Number(
      adapter.env.get("PORT") ?? adapter.env.get("VERYFRONT_PORT") ?? DEFAULT_SERVER_PORT,
    );
    // BIND_ADDRESS: 0.0.0.0 = all interfaces, 127.0.0.1 = localhost only
    // Note: Don't use HOSTNAME - K8s sets it to pod name which resolves to pod IP
    const bindAddress = adapter.env.get("BIND_ADDRESS") ?? "0.0.0.0";

    const bootstrap = await bootstrapProd(projectDir, adapter);

    const server = await startProductionServer({
      projectDir,
      port,
      bindAddress,
      debug: isDebugEnabled(adapter.env),
      adapter, // Pass adapter to avoid re-detection
      bootstrapResult: bootstrap,
      signal: shutdownController.signal,
    });

    // Wait for server to be fully ready before accepting traffic
    // This prevents K8s readiness probe from passing too early
    // Note: setServerInitialized(true) is called inside ready promise
    await server.ready;
    logger.info("Server fully initialized, ready to accept traffic");

    // Graceful shutdown for direct CLI execution (e.g., deno run)
    // Default drain timeout: 25 seconds (K8s default terminationGracePeriodSeconds is 30)
    const drainTimeoutMs = parseShutdownDrainTimeoutMs(
      adapter.env.get("SHUTDOWN_DRAIN_TIMEOUT_MS"),
    );

    let shuttingDown = false;
    const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;

      await gracefullyShutdownProductionServer({
        signal,
        drainTimeoutMs,
        abort: () => shutdownController.abort(),
        stop: server.stop,
        logger,
      });
    };

    const handleSignal = (signal: "SIGINT" | "SIGTERM"): void => {
      void shutdown(signal).catch((error) => {
        logger.warn("Unhandled error while shutting down production server", { signal, error });
      });
    };

    onSignal("SIGINT", () => handleSignal("SIGINT"));
    onSignal("SIGTERM", () => handleSignal("SIGTERM"));
  } catch (e) {
    logger.error("Failed to start production server:", e);
    // Re-throw so the process exits with a non-zero code. A running process with no HTTP
    // listener causes K8s readiness probes to fail eventually, but crashing immediately
    // signals the orchestrator to restart the pod faster.
    throw e;
  }
}
