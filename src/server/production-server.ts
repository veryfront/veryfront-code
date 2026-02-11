import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createVeryfrontHandler } from "./runtime-handler/index.ts";
import { requestTracker } from "./runtime-handler/request-tracker.ts";
import { bootstrapProd, type BootstrapResult } from "./bootstrap.ts";
import { cwd, onGlobalError, onSignal } from "#veryfront/platform/compat/process.ts";
import { isDebugEnabled } from "#veryfront/utils/constants/env.ts";
import {
  initializeOTLPWithApis,
  shutdownOTLP,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  getMemorySnapshot,
  startMemoryMonitoring,
  stopMemoryMonitoring,
} from "#veryfront/utils/memory/index.ts";
import { initializeDistributedCaches } from "#veryfront/cache/distributed-cache-init.ts";
import { setServerInitialized } from "./handlers/monitoring/health.handler.ts";
import {
  enableSSRClientOnlyFetching,
  enableSSRFetchInterception,
  setSSRServerPort,
} from "#veryfront/rendering/ssr-globals.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

const serverLog = logger.component("server");
const globalLog = logger.component("global");

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

export interface ServerHandle {
  ready: Promise<void>;
  stop: () => Promise<void>;
}

export interface StartProductionServerOptions extends ServerOptions {
  debug?: boolean;
  adapter?: RuntimeAdapter;
  /** Pre-computed bootstrap result to skip internal bootstrap (avoids double initialization) */
  bootstrapResult?: BootstrapResult;
}

export function startProductionServer(
  options: StartProductionServerOptions,
): Promise<ServerHandle> {
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
        defaultEnvironment,
        requestInterceptor,
        bootstrapResult,
        discoveryConfig,
        localProjects,
      } = options;

      const baseAdapter = options.adapter ?? (await runtime.get());

      // Use pre-computed bootstrap result if provided, otherwise bootstrap here
      const bootstrap = bootstrapResult ?? await bootstrapProd(projectDir, baseAdapter);
      const adapter = bootstrap.adapter;

      if (bootstrap.usingFSAdapter) {
        logger.debug("FSAdapter initialized", { type: bootstrap.fsAdapterType });
      }

      // Enable SSR fetch interception to handle relative URLs during SSR
      setSSRServerPort(port);
      enableSSRFetchInterception();

      // Enable client-only fetching for /api/* routes in production.
      // This returns empty mock responses during SSR (instead of failing with
      // "Invalid URL" or "Connection refused"). React Query will refetch
      // the actual data client-side after hydration.
      enableSSRClientOnlyFetching();

      // Run AI discovery before serving (registries must be populated before first request)
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
            );
          } else {
            await discoverAll({
              baseDir: discoveryConfig.baseDir,
              fsAdapter: discoveryConfig.fsAdapter,
              verbose: discoveryConfig.verbose ?? false,
            });
          }
        } catch (error) {
          serverLog.debug("AI discovery skipped:", error);
        }
      }

      logger.info("Starting production server", { projectDir, port, bindAddress });

      const baseHandler = createVeryfrontHandler(projectDir, adapter, {
        projectDir,
        debug,
        config: bootstrap.config,
        defaultProjectSlug,
        defaultProjectId,
        defaultEnvironment,
        localProjects,
      });

      // Wrap handler with interceptor if provided (for combined mode)
      // WebSocket upgrade requests MUST NOT be intercepted because the interceptor
      // creates a new Request object, which breaks Deno.upgradeWebSocket()
      const handler = requestInterceptor
        ? Object.assign(
          async (req: Request) => {
            const isWebSocketUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
            if (isWebSocketUpgrade) return baseHandler(req);
            return baseHandler(await requestInterceptor(req));
          },
          { ready: baseHandler.ready },
        )
        : baseHandler;

      let resolveListenReady: (() => void) | undefined;
      const listenReady = new Promise<void>((resolve) => {
        resolveListenReady = resolve;
      });

      const ready = Promise.all([listenReady, handler.ready ?? Promise.resolve()]).then(() => {
        // Mark server as initialized when ready resolves
        setServerInitialized(true);
      });

      const server = await adapter.serve(handler, {
        port,
        hostname: bindAddress, // Deno uses "hostname" for bind address
        signal,
        onListen: (params) => {
          resolveListenReady?.();
          logger.info("Production server listening", params);
        },
      });

      async function stop(): Promise<void> {
        setServerInitialized(false);

        try {
          await server.stop();
        } catch (error) {
          logger.debug("Server stop failed", { error });
        }
      }

      return { ready, stop };
    },
    { "server.port": options.port, "server.bindAddress": options.bindAddress ?? "0.0.0.0" },
  );
}

if (import.meta.main) {
  // Register global error handlers FIRST to prevent process crashes from application errors
  // This ensures the renderer stays up even if user code throws unhandled exceptions
  onGlobalError((error, type) => {
    // Fatal errors that indicate corrupted process state — let the process crash
    // so the orchestrator (k8s) can restart it cleanly
    const isFatal = (error.name === "RangeError" && error.message.includes("Maximum call stack")) ||
      error.message.includes("out of memory") ||
      error.message.includes("allocation failed");

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
      initializeDistributedCaches(),
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

    // Start memory monitoring if enabled
    const enableMemoryMonitoring = adapter.env.get("ENABLE_MEMORY_MONITORING") === "true";
    const monitoringIntervalMs = parseInt(
      adapter.env.get("MEMORY_MONITORING_INTERVAL_MS") ?? "30000",
      10,
    );

    if (enableMemoryMonitoring) {
      startMemoryMonitoring(monitoringIntervalMs);
      logger.debug("Memory monitoring enabled", { intervalMs: monitoringIntervalMs });

      // Log initial memory state
      const initialSnapshot = getMemorySnapshot();
      logger.debug("Initial memory state", {
        heapUsedMB: initialSnapshot.heap.usedHeapSizeMB,
        heapLimitMB: initialSnapshot.heap.heapSizeLimitMB,
        cacheCount: initialSnapshot.caches.length,
      });
    }

    const shutdownController = new AbortController();
    const projectDir = cwd();
    const port = Number(adapter.env.get("PORT") ?? adapter.env.get("VERYFRONT_PORT") ?? 3000);
    // BIND_ADDRESS: 0.0.0.0 = all interfaces, 127.0.0.1 = localhost only
    // Note: Don't use HOSTNAME - K8s sets it to pod name which resolves to pod IP
    const bindAddress = adapter.env.get("BIND_ADDRESS") ?? "0.0.0.0";

    const server = await startProductionServer({
      projectDir,
      port,
      bindAddress,
      debug: isDebugEnabled(adapter.env),
      adapter, // Pass adapter to avoid re-detection
      signal: shutdownController.signal,
    });

    // Wait for server to be fully ready before accepting traffic
    // This prevents K8s readiness probe from passing too early
    // Note: setServerInitialized(true) is called inside ready promise
    await server.ready;
    logger.info("Server fully initialized, ready to accept traffic");

    // Graceful shutdown for direct CLI execution (e.g., deno run)
    // Default drain timeout: 25 seconds (K8s default terminationGracePeriodSeconds is 30)
    const drainTimeoutMs = parseInt(adapter.env.get("SHUTDOWN_DRAIN_TIMEOUT_MS") ?? "25000", 10);

    let shuttingDown = false;
    const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info(`Received ${signal}, initiating graceful shutdown...`, {
        inFlightRequests: requestTracker.getInFlightCount(),
        drainTimeoutMs,
      });

      // Phase 1: Mark server as not ready to stop K8s from routing new requests
      setServerInitialized(false);
      logger.info("Server marked as not ready, waiting for in-flight requests to drain...");

      try {
        // Phase 2: Wait for in-flight requests to complete (graceful drain)
        const drained = await requestTracker.waitForDrain(drainTimeoutMs);
        if (!drained) {
          logger.warn("Drain timeout exceeded, forcing shutdown", {
            remainingRequests: requestTracker.getInFlightCount(),
          });
        }

        // Phase 3: Stop accepting new connections and clean up
        stopMemoryMonitoring();
        requestTracker.shutdown();
        shutdownController.abort();
        await server.stop();
        await shutdownOTLP();

        logger.info("Graceful shutdown complete");
      } catch (error) {
        logger.warn("Error while shutting down production server:", error);
      }
    };

    onSignal("SIGINT", () => void shutdown("SIGINT"));
    onSignal("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (e) {
    logger.error("Failed to start production server:", e);
  }
}
