import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createVeryfrontHandler } from "./runtime-handler/index.ts";
import { bootstrapProd, type BootstrapResult } from "./bootstrap.ts";
import { cwd, onGlobalError, onSignal } from "#veryfront/platform/compat/process.ts";
import { isDebugEnabled } from "#veryfront/utils/constants/env.ts";
import { initializeOTLPWithApis, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { acquireConfiguredMemoryMonitoring } from "#veryfront/utils/memory/index.ts";
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
import {
  gracefullyShutdownProductionServer,
  parseShutdownDrainTimeoutMs,
} from "./graceful-shutdown.ts";
import {
  acquireSSRFetchInterception,
  runWithSSRRequestGlobals,
} from "#veryfront/rendering/ssr-globals.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { assertPrimitiveDiscoverySucceeded } from "./primitive-discovery.ts";

const serverLog = logger.component("server");
const globalLog = logger.component("global");

type ProductionGlobalErrorType = "uncaughtException" | "unhandledRejection";
type ProductionGlobalErrorLogger = Pick<typeof globalLog, "error">;

function getErrorName(error: unknown): string {
  try {
    if (error instanceof Error && /^[A-Za-z][A-Za-z0-9.]{0,127}$/.test(error.name)) {
      return error.name;
    }
  } catch {
    // Hostile errors are reported using the generic name below.
  }
  return "Error";
}

function getErrorLogContext(error: unknown): { errorName: string } {
  return { errorName: getErrorName(error) };
}

function assertProductionStartNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Production server start was aborted", "AbortError");
  }
}

export interface ProductionInfrastructureInitializers {
  initializeTracing?: () => Promise<unknown>;
  initializeCaches?: () => Promise<unknown>;
}

/** Initialize optional tracing and required configured cache infrastructure. */
export async function initializeProductionInfrastructure(
  initializers: ProductionInfrastructureInitializers = {},
): Promise<void> {
  const initializeTracing = initializers.initializeTracing ?? initializeOTLPWithApis;
  const initializeCaches = initializers.initializeCaches ??
    (() => initializeDistributedCaches(defaultDistributedCacheInitializers));

  const tracingTask = Promise.resolve()
    .then(initializeTracing)
    .catch((error) => {
      logger.warn("OTLP initialization failed, continuing without tracing", {
        ...getErrorLogContext(error),
      });
    });
  const cacheTask = Promise.resolve().then(initializeCaches);

  await Promise.all([tracingTask, cacheTask]);
}

/** Log an unhandled process error without exposing its message or stack. */
export function handleProductionGlobalError(
  error: Error,
  type: ProductionGlobalErrorType,
  log: ProductionGlobalErrorLogger = globalLog,
): false {
  log.error("Unhandled process error", {
    type,
    errorName: getErrorName(error),
    fatal: true,
  });

  // An error that escapes every request and task boundary can leave shared
  // process state inconsistent. Preserve the runtime's fatal behavior so the
  // process supervisor can replace the instance cleanly.
  return false;
}

/** Default port when PORT / VERYFRONT_PORT env vars are not set */
const DEFAULT_SERVER_PORT = 3_000;

export function parseProductionServerPort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SERVER_PORT;
  if (!/^\d+$/.test(raw)) {
    throw new TypeError("Production server port must be an integer between 1 and 65535");
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("Production server port must be an integer between 1 and 65535");
  }
  return port;
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
      fileCount: files.length,
      fromCache: result.fromCache,
    });
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
  /** Override the host-derived environment in standalone mode. */
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
  ready: Promise<void>;
  stop: () => Promise<void>;
}

/** Options accepted by start production server. */
export interface StartProductionServerOptions extends ServerOptions {
  debug?: boolean;
  adapter?: RuntimeAdapter;
  /** Pre-computed bootstrap result to skip internal bootstrap. */
  bootstrapResult?: BootstrapResult;
  /**
   * Controls who releases an injected bootstrap. The default is `borrowed`,
   * which preserves the caller's existing ownership. Internally created
   * bootstraps are always owned by the server.
   */
  bootstrapOwnership?: "borrowed" | "transferred";
}

/** Starts production server. */
export function startProductionServer(
  options: StartProductionServerOptions,
): Promise<ServerHandle> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    return Promise.reject(
      new TypeError("Production server port must be an integer between 0 and 65535"),
    );
  }
  if (
    options.bootstrapResult && options.adapter &&
    options.bootstrapResult.adapter !== options.adapter
  ) {
    return Promise.reject(
      new TypeError("Production server adapter must match the injected bootstrap adapter"),
    );
  }
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException("Production server start was aborted", "AbortError"));
  }
  return withSpan(
    "server.startProductionServer",
    async () => {
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
        bootstrapResult,
        bootstrapOwnership = "borrowed",
        discoveryConfig,
        localProjects,
      } = options;

      if (!bootstrapResult && bootstrapOwnership === "transferred") {
        throw new TypeError("bootstrapOwnership requires bootstrapResult");
      }
      const baseAdapter = bootstrapResult?.adapter ?? options.adapter ?? (await runtime.get());
      assertProductionStartNotAborted(signal);
      const memoryMonitoringLease = acquireConfiguredMemoryMonitoring(baseAdapter.env);
      const ownsBootstrap = bootstrapResult === undefined || bootstrapOwnership === "transferred";
      let bootstrap: BootstrapResult | undefined;
      let server: Awaited<ReturnType<RuntimeAdapter["serve"]>> | undefined;
      let releaseSSRFetchInterception: (() => void) | undefined;
      let stopPromise: Promise<void> | undefined;
      let serverReady = false;
      let activeServerPort = port;
      let resolveStopRequested: () => void = () => {};
      const stopRequested = new Promise<void>((resolve) => {
        resolveStopRequested = resolve;
      });

      const stop = (): Promise<void> => {
        if (stopPromise) return stopPromise;

        serverReady = false;
        resolveStopRequested();
        stopPromise = (async () => {
          const failures: unknown[] = [];

          try {
            await server?.stop();
          } catch (error) {
            failures.push(error);
          }

          if (ownsBootstrap && bootstrap?.dispose) {
            try {
              await bootstrap.dispose();
            } catch (error) {
              failures.push(error);
            }
          }

          try {
            releaseSSRFetchInterception?.();
          } catch (error) {
            failures.push(error);
          }

          try {
            memoryMonitoringLease.release();
          } catch (error) {
            failures.push(error);
          }

          if (failures.length > 0) {
            throw new AggregateError(failures, "Production server cleanup failed");
          }
        })();

        return stopPromise;
      };

      try {
        // Use pre-computed bootstrap result if provided, otherwise bootstrap here
        bootstrap = bootstrapResult ?? await bootstrapProd(projectDir, baseAdapter);
        assertProductionStartNotAborted(signal);
        const adapter = bootstrap.adapter;

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
        assertProductionStartNotAborted(signal);

        // Enable SSR fetch interception to handle relative URLs during SSR
        releaseSSRFetchInterception = acquireSSRFetchInterception();

        // Run primitive discovery before serving (registries must be populated before first request)
        if (discoveryConfig) {
          try {
            const { discoverAll } = await import("#veryfront/discovery");
            const { isExtendedFSAdapter } = await import(
              "#veryfront/platform/adapters/fs/wrapper.ts"
            );

            const result = (
                discoveryConfig.projectSlug && discoveryConfig.apiToken &&
                discoveryConfig.fsAdapter && isExtendedFSAdapter(discoveryConfig.fsAdapter) &&
                discoveryConfig.fsAdapter.isMultiProjectMode()
              )
              // Multi-project proxy: scope discovery to specific project
              ? await discoveryConfig.fsAdapter.runWithContext(
                discoveryConfig.projectSlug,
                discoveryConfig.apiToken,
                () =>
                  discoverAll({
                    baseDir: discoveryConfig.baseDir,
                    fsAdapter: discoveryConfig.fsAdapter,
                    verbose: discoveryConfig.verbose ?? false,
                  }),
              )
              : await discoverAll({
                baseDir: discoveryConfig.baseDir,
                fsAdapter: discoveryConfig.fsAdapter,
                verbose: discoveryConfig.verbose ?? false,
              });
            assertPrimitiveDiscoverySucceeded(result);
          } catch (error) {
            serverLog.error("Primitive discovery failed", getErrorLogContext(error));
            throw error;
          }
        }
        assertProductionStartNotAborted(signal);

        logger.info("Starting production server", { port });

        const baseHandler = createVeryfrontHandler(projectDir, adapter, {
          projectDir,
          debug,
          config: bootstrap.config,
          defaultProjectSlug,
          defaultProjectId,
          defaultReleaseId,
          defaultEnvironment,
          localProjects,
          isServerReady: () => serverReady,
        });

        const coreHandler = baseHandler;

        // Wrap handler with interceptor if provided (for combined mode)
        // WebSocket upgrade requests MUST NOT be intercepted because the interceptor
        // creates a new Request object, which breaks Deno.upgradeWebSocket()
        const interceptedHandler = requestInterceptor
          ? Object.assign(
            async (req: Request) => {
              const isWebSocketUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
              if (isWebSocketUpgrade) return coreHandler(req);
              return coreHandler(await requestInterceptor(req));
            },
            { ready: coreHandler.ready },
          )
          : coreHandler;
        const handler = Object.assign(
          (req: Request) =>
            runWithSSRRequestGlobals(
              // Production SSR must observe real API responses, not synthetic empty success data.
              { clientOnlyFetching: false, serverPort: activeServerPort },
              () => interceptedHandler(req),
            ),
          { ready: interceptedHandler.ready },
        );

        let resolveListenReady: (() => void) | undefined;
        const listenReady = new Promise<void>((resolve) => {
          resolveListenReady = resolve;
        });

        server = await adapter.serve(handler, {
          port,
          hostname: bindAddress, // Deno uses "hostname" for bind address
          signal,
          onListen: (params) => {
            activeServerPort = params.port;
            resolveListenReady?.();
            logger.info("Production server listening");
          },
        });

        const initialization = Promise.all([listenReady, handler.ready ?? Promise.resolve()]);
        const stoppedBeforeReady = stopRequested.then(() => {
          throw new Error("Production server stopped before becoming ready");
        });
        const ready = Promise.race([initialization, stoppedBeforeReady])
          .then(() => {
            if (stopPromise) {
              throw new Error("Production server stopped before becoming ready");
            }
            serverReady = true;
          })
          .catch(async (error) => {
            serverReady = false;
            try {
              await stop();
            } catch (cleanupError) {
              logger.warn("Production server cleanup failed after readiness failure", {
                ...getErrorLogContext(cleanupError),
              });
            }
            throw error;
          });

        return { ready, stop };
      } catch (error) {
        serverReady = false;
        try {
          await stop();
        } catch (cleanupError) {
          logger.warn("Production server cleanup failed after startup failure", {
            ...getErrorLogContext(cleanupError),
          });
        }
        throw error;
      }
    },
    { "server.port": options.port },
  );
}

if (import.meta.main) {
  const removeGlobalErrorHandlers = onGlobalError(handleProductionGlobalError);
  const removeSignalHandlers: Array<() => void> = [];
  let processHandlersActive = true;
  const removeProcessHandlers = (): void => {
    if (!processHandlersActive) return;
    processHandlersActive = false;
    const removers = [...removeSignalHandlers.splice(0), removeGlobalErrorHandlers];
    for (const remove of removers) {
      try {
        remove();
      } catch (error) {
        logger.warn("Failed to remove a production process handler", getErrorLogContext(error));
      }
    }
  };

  try {
    await initializeProductionInfrastructure();

    const adapter = await runtime.get();

    const shutdownController = new AbortController();
    const projectDir = cwd();
    const port = parseProductionServerPort(
      adapter.env.get("PORT") ?? adapter.env.get("VERYFRONT_PORT"),
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
      bootstrapOwnership: "transferred",
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
      try {
        await gracefullyShutdownProductionServer({
          signal,
          drainTimeoutMs,
          abort: () => shutdownController.abort(),
          stop: server.stop,
          logger,
        });
      } finally {
        removeProcessHandlers();
      }
    };

    const handleSignal = (signal: "SIGINT" | "SIGTERM"): void => {
      void shutdown(signal).catch((error) => {
        logger.warn("Unhandled error while shutting down production server", {
          signal,
          ...getErrorLogContext(error),
        });
      });
    };

    removeSignalHandlers.push(onSignal("SIGINT", () => handleSignal("SIGINT")));
    removeSignalHandlers.push(onSignal("SIGTERM", () => handleSignal("SIGTERM")));
  } catch (e) {
    removeProcessHandlers();
    logger.error("Failed to start production server", getErrorLogContext(e));
    // Re-throw so the process exits with a non-zero code. A running process with no HTTP
    // listener causes K8s readiness probes to fail eventually, but crashing immediately
    // signals the orchestrator to restart the pod faster.
    throw e;
  }
}
