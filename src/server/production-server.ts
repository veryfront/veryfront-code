import { serverLogger as logger } from "#veryfront/utils";
import { installUnhandledRejectionGuard } from "#veryfront/server/unhandled-rejection-guard.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createVeryfrontHandler } from "./runtime-handler/index.ts";
import { bootstrapProd, type BootstrapResult } from "./bootstrap.ts";
import { cwd, exit, onGlobalError, onSignal } from "#veryfront/platform/compat/process.ts";
import { isDebugEnabled } from "#veryfront/utils/constants/env.ts";
import { initializeOTLPWithApis, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  type MemoryRecycleEvent,
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
  enableSSRClientOnlyFetching,
  enableSSRFetchInterception,
  setSSRServerPort,
} from "#veryfront/rendering/ssr-globals.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { snapshotNodeWebSocketServerProvider } from "#veryfront/extensions/websocket";
import {
  HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
  isHostProjectExecutionOverrideEnabled,
} from "#veryfront/security/host-execution-policy.ts";
import { isSharedProjectRuntime } from "#veryfront/security/project-locality.ts";
import { getIsolationPosture } from "#veryfront/security/sandbox/worker-pool.ts";
import { runStartupDiscovery } from "./startup-discovery.ts";
import { runRequestInterceptor } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { runProductionProcessOwner } from "./production-shutdown-coordinator.ts";
import { isServerShuttingDown } from "./shutdown-state.ts";

const serverLog = logger.component("server");
const globalLog = logger.component("global");

/** Default port when PORT / VERYFRONT_PORT env vars are not set */
const DEFAULT_SERVER_PORT = 3_000;

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
  ready: Promise<void>;
  stop: () => Promise<void>;
}

/** Options accepted by start production server. */
export interface StartProductionServerOptions extends ServerOptions {
  debug?: boolean;
  adapter?: RuntimeAdapter;
  /** Pre-computed bootstrap result to skip internal bootstrap (avoids double initialization) */
  bootstrapResult?: BootstrapResult;
  /**
   * Contain unhandled promise rejections instead of letting them terminate the
   * process. Defaults to true.
   *
   * The hosted runtime serves many projects per process, where one project's
   * dropped promise otherwise takes down every other project on the pod. Set
   * this to false when embedding the server in a process you own and would
   * rather have a rejection stay fatal, so a bug outside the server is not
   * masked. Rejections are reported at error level either way.
   */
  unhandledRejectionGuard?: boolean;
  /**
   * Process-owner callback for an explicitly enabled RSS recycle policy.
   * Embedded callers must omit this so the server never terminates its host.
   */
  onMemoryRecycle?: (event: MemoryRecycleEvent) => void | Promise<void>;
}

interface DirectProductionServerDependencies {
  flush: () => Promise<unknown>;
  captureError: (error: unknown, context: { boundary: string }) => void;
  initializeErrorReporting?: () => Promise<unknown>;
  initializeRuntime?: () => Promise<void>;
  getAdapter?: () => Promise<RuntimeAdapter>;
  bootstrap?: typeof bootstrapProd;
  startServer?: typeof startProductionServer;
  gracefullyShutdown?: typeof gracefullyShutdownProductionServer;
  exit?: (code: number) => void;
  registerSignals?: (
    handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>,
  ) => void | (() => void);
}

interface StartProductionServerDependencies {
  bootstrap: typeof bootstrapProd;
}

/** Starts production server. */
export function startProductionServer(
  options: StartProductionServerOptions,
): Promise<ServerHandle> {
  return startProductionServerWithDependencies(options, { bootstrap: bootstrapProd });
}

/** @internal Starts a production server with explicit lifecycle dependencies. */
export function startProductionServerWithDependencies(
  options: StartProductionServerOptions,
  dependencies: StartProductionServerDependencies,
): Promise<ServerHandle> {
  const suppliedBootstrap = options.bootstrapResult;
  const suppliedProviderSource = suppliedBootstrap?.nodeWebSocketServerProvider;
  const suppliedNodeWebSocketServerProvider = suppliedProviderSource === undefined
    ? undefined
    : snapshotNodeWebSocketServerProvider(suppliedProviderSource);
  let ownedBootstrap: BootstrapResult | undefined;
  let ownedBootstrapDisposal: Promise<void> | undefined;
  const disposeOwnedBootstrap = (): Promise<void> => {
    if (!ownedBootstrap) return Promise.resolve();
    ownedBootstrapDisposal ??= Promise.resolve().then(() => ownedBootstrap?.dispose?.());
    return ownedBootstrapDisposal;
  };

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
        discoveryConfig,
        localProjects,
      } = options;

      const baseAdapter = options.adapter ?? (await runtime.get());
      const memoryMonitoringConfig = startConfiguredMemoryMonitoring(baseAdapter.env, {
        onRecycle: options.onMemoryRecycle,
      });
      const ownsMemoryMonitoring = memoryMonitoringConfig.enabled;
      // Installed before bootstrap so a rejection during startup is contained
      // too. This process serves every project on the pod, so one dropped
      // promise must not take the others down with it. Embedders that own the
      // process can opt out and keep rejections fatal.
      const rejectionGuard = options.unhandledRejectionGuard === false
        ? undefined
        : installUnhandledRejectionGuard();

      try {
        // Use pre-computed bootstrap result if provided, otherwise bootstrap here
        const bootstrap = suppliedBootstrap ??
          await dependencies.bootstrap(projectDir, baseAdapter);
        if (!suppliedBootstrap) ownedBootstrap = bootstrap;
        const adapter = bootstrap.adapter;
        const nodeWebSocketServerProvider = suppliedBootstrap === undefined
          ? bootstrap.nodeWebSocketServerProvider
          : suppliedNodeWebSocketServerProvider;

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
        setSSRServerPort(port);
        enableSSRFetchInterception();

        // Enable client-only fetching for /api/* routes in production.
        // This returns empty mock responses during SSR (instead of failing with
        // "Invalid URL" or "Connection refused"). React Query will refetch
        // the actual data client-side after hydration.
        enableSSRClientOnlyFetching();

        // A dedicated single-project runtime carries the capability implicitly.
        // A shared runtime intended to be the executor must be granted it by an
        // operator, deliberately and visibly.
        //
        // Computed before discovery so startup and request handling share one
        // value. They disagreed before issue-inbox#363: discovery hardcoded a
        // grant while the handler computed the real posture.
        const isolatedRuntimeGrant = bootstrap.config.fs?.veryfront?.proxyMode !== true &&
          !isSharedProjectRuntime({ adapter });
        const operatorGrant = isHostProjectExecutionOverrideEnabled();
        const allowHostProjectCodeExecution = isolatedRuntimeGrant || operatorGrant;

        // Run primitive discovery before serving (registries must be populated before first request)
        if (discoveryConfig) {
          try {
            const { discoverAll } = await import("#veryfront/discovery");
            const { isExtendedFSAdapter } = await import(
              "#veryfront/platform/adapters/fs/wrapper.ts"
            );

            const outcome = await runStartupDiscovery({
              config: discoveryConfig,
              allowHostProjectCodeExecution,
              discoverAll,
              isExtendedFSAdapter,
            });

            if (!outcome.ran) {
              serverLog.info("Primitive discovery skipped", { reason: outcome.reason });
            }
          } catch (error) {
            serverLog.error("Primitive discovery failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info("Starting production server", { projectDir, port, bindAddress });

        // Resolve the isolation flags here rather than leaving them to the
        // first request, so the posture (including the warning for a master
        // switch that enables no surface) lands in the startup log where an
        // operator looks for it.
        getIsolationPosture();

        if (operatorGrant && !isolatedRuntimeGrant) {
          logger.warn("Shared runtime is executing tenant project code by operator grant", {
            overrideEnv: HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
            proxyMode: bootstrap.config.fs?.veryfront?.proxyMode === true,
          });
        }

        const baseHandler = createVeryfrontHandler(projectDir, adapter, {
          projectDir,
          debug,
          config: bootstrap.config,
          defaultProjectSlug,
          defaultProjectId,
          defaultReleaseId,
          defaultEnvironment,
          localProjects,
          allowHostProjectCodeExecution,
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
              return coreHandler(await runRequestInterceptor(req, requestInterceptor));
            },
            { ready: coreHandler.ready },
          )
          : coreHandler;

        let resolveListenReady: (() => void) | undefined;
        const listenReady = new Promise<void>((resolve) => {
          resolveListenReady = resolve;
        });

        const ready = (async () => {
          await Promise.all([listenReady, handler.ready ?? Promise.resolve()]);
          // Readiness can settle after a signal or memory-pressure shutdown has
          // already entered lame-duck mode. Never publish ready again then.
          if (!signal?.aborted && !isServerShuttingDown()) {
            setServerInitialized(true);
          }
        })();

        const server = await adapter.serve(handler, {
          port,
          hostname: bindAddress, // Deno uses "hostname" for bind address
          signal,
          nodeWebSocketServerProvider,
          onListen: (params) => {
            resolveListenReady?.();
            logger.info("Production server listening", params);
          },
        });

        const stop = async (): Promise<void> => {
          setServerInitialized(false);
          if (ownsMemoryMonitoring) stopMemoryMonitoring();
          rejectionGuard?.dispose();

          try {
            await server.stop();
          } catch (error) {
            logger.debug("Server stop failed", { error });
          }
          await disposeOwnedBootstrap();
        };

        return { ready, stop };
      } catch (error) {
        if (ownsMemoryMonitoring) stopMemoryMonitoring();
        rejectionGuard?.dispose();
        try {
          await disposeOwnedBootstrap();
        } catch (disposeError) {
          logger.warn("Failed to dispose production bootstrap after startup error", {
            error: disposeError,
          });
        }
        throw error;
      }
    },
    { "server.port": options.port, "server.bindAddress": options.bindAddress ?? "0.0.0.0" },
  );
}

/** Own the direct production entry from initialization through process exit. */
export async function runDirectProductionServer(
  dependencies: DirectProductionServerDependencies,
): Promise<void> {
  let bootstrap: BootstrapResult | undefined;
  let bootstrapAtShutdownStart: BootstrapResult | undefined;
  let finalizedLateBootstrap: BootstrapResult | undefined;
  let bootstrapDisposal: Promise<void> | undefined;
  let drainTimeoutMs: number | undefined;
  const disposeBootstrap = (): Promise<void> => {
    if (!bootstrap) return Promise.resolve();
    bootstrapDisposal ??= Promise.resolve().then(() => bootstrap?.dispose?.());
    return bootstrapDisposal;
  };

  await runProductionProcessOwner({
    start: async ({ signal, onMemoryRecycle }) => {
      await dependencies.initializeErrorReporting?.();
      if (dependencies.initializeRuntime) {
        await dependencies.initializeRuntime();
      } else {
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
      }

      const adapter = await (dependencies.getAdapter ? dependencies.getAdapter() : runtime.get());
      const projectDir = cwd();
      const port = Number(
        adapter.env.get("PORT") ?? adapter.env.get("VERYFRONT_PORT") ?? DEFAULT_SERVER_PORT,
      );
      const bindAddress = adapter.env.get("BIND_ADDRESS") ?? "0.0.0.0";
      bootstrap = await (dependencies.bootstrap ?? bootstrapProd)(projectDir, adapter);
      if (signal.aborted) {
        await disposeBootstrap();
        signal.throwIfAborted();
      }
      drainTimeoutMs = parseShutdownDrainTimeoutMs(
        adapter.env.get("SHUTDOWN_DRAIN_TIMEOUT_MS"),
      );

      try {
        return await (dependencies.startServer ?? startProductionServer)({
          projectDir,
          port,
          bindAddress,
          debug: isDebugEnabled(adapter.env),
          adapter,
          bootstrapResult: bootstrap,
          signal,
          onMemoryRecycle,
        });
      } catch (error) {
        try {
          await disposeBootstrap();
        } catch {
          // Preserve the server startup failure as the process-owner result.
        }
        throw error;
      }
    },
    shutdown: async (reason, server, abort) => {
      bootstrapAtShutdownStart = bootstrap;
      await (dependencies.gracefullyShutdown ?? gracefullyShutdownProductionServer)({
        signal: reason,
        drainTimeoutMs,
        abort,
        dispose: disposeBootstrap,
        stop: server?.stop ?? (() => Promise.resolve()),
        logger,
      });
      // Bootstrap can finish while graceful shutdown is already running. Its
      // dynamic owner releases it here if the earlier cleanup step saw none.
      if (bootstrap && bootstrap !== bootstrapAtShutdownStart) await disposeBootstrap();
    },
    flush: dependencies.flush,
    beforeExit: () =>
      bootstrap && bootstrap !== bootstrapAtShutdownStart ? disposeBootstrap() : Promise.resolve(),
    finalizeBeforeExit: () => {
      if (
        !bootstrap || bootstrap === bootstrapAtShutdownStart ||
        bootstrap === finalizedLateBootstrap
      ) return undefined;
      finalizedLateBootstrap = bootstrap;
      return disposeBootstrap();
    },
    exit: dependencies.exit ?? exit,
    registerSignals: dependencies.registerSignals ?? ((handler) => {
      const disposeInterrupt = onSignal("SIGINT", () => handler("SIGINT"));
      try {
        const disposeTerminate = onSignal("SIGTERM", () => handler("SIGTERM"));
        return () => {
          disposeInterrupt();
          disposeTerminate();
        };
      } catch (error) {
        disposeInterrupt();
        throw error;
      }
    }),
    onReady: () => logger.info("Server fully initialized, ready to accept traffic"),
    onError: (error, reason) => {
      dependencies.captureError(error, { boundary: "process.shutdown" });
      logger.warn("Unhandled error while shutting down production server", { reason, error });
    },
  });
}

if (import.meta.main) {
  const {
    captureApplicationError,
    flushApplicationErrors,
  } = await import("#veryfront/observability/application-errors.ts");
  const { initializeSentryFromEnv } = await import("#veryfront/observability/sentry.ts");

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

    captureApplicationError(error, {
      boundary: `process.${type}`,
    });

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
    await runDirectProductionServer({
      flush: flushApplicationErrors,
      captureError: captureApplicationError,
      initializeErrorReporting: initializeSentryFromEnv,
    });
  } catch (e) {
    captureApplicationError(e, { boundary: "process.startup" });
    logger.error("Failed to start production server:", e);
    await flushApplicationErrors();
    // Re-throw so the process exits with a non-zero code. A running process with no HTTP
    // listener causes K8s readiness probes to fail eventually, but crashing immediately
    // signals the orchestrator to restart the pod faster.
    throw e;
  }
}
