import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createVeryfrontHandler } from "./universal-handler/index.ts";
import { requestTracker } from "./universal-handler/request-tracker.ts";
import { bootstrapProd } from "./bootstrap.ts";
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
import { setServerInitialized } from "./handlers/monitoring/health.ts";
import {
  enableSSRClientOnlyFetching,
  enableSSRFetchInterception,
  setSSRServerPort,
} from "../rendering/ssr-globals.ts";

interface ServerOptions {
  projectDir: string;
  port: number;
  /** 0.0.0.0 = all interfaces, 127.0.0.1 = localhost only */
  bindAddress?: string;
  signal?: AbortSignal;
  /** Server mode - "development" enables dev-only features like /_veryfront/fs/ */
  mode?: "development" | "production";
  /** Default project slug when not provided via proxy headers (for tests/local mode) */
  defaultProjectSlug?: string;
  /** Default project ID when not provided via proxy headers (for tests/local mode) */
  defaultProjectId?: string;
  /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
  defaultEnvironment?: "preview" | "production";
}

export interface ServerHandle {
  ready: Promise<void>;
  stop: () => Promise<void>;
}

export function startUniversalServer(
  options: ServerOptions & {
    debug?: boolean;
    adapter?: RuntimeAdapter;
  },
): Promise<ServerHandle> {
  return withSpan(
    "server.startUniversalServer",
    async () => {
      const {
        projectDir,
        port,
        bindAddress = "0.0.0.0",
        signal,
        debug,
        mode,
        defaultProjectSlug,
        defaultProjectId,
        defaultEnvironment,
      } = options;
      const baseAdapter = options.adapter ?? (await runtime.get());

      // Bootstrap framework to initialize FSAdapter if configured
      const bootstrap = await bootstrapProd(projectDir, baseAdapter);
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

      logger.info("Starting universal production server", { projectDir, port, bindAddress });

      const handler = createVeryfrontHandler(projectDir, adapter, {
        projectDir,
        debug,
        config: bootstrap.config,
        // When mode is "development", enable dev-only features (e.g., /_veryfront/fs/)
        // Otherwise explicitly disable dev mode (don't rely on NODE_ENV which may not be set in tests)
        envConfig: mode === "development" ? { isLocalDev: true } : { isLocalDev: false },
        defaultProjectSlug,
        defaultProjectId,
        defaultEnvironment,
      });

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
          logger.info("Universal server listening", params);
        },
      });

      async function stop(): Promise<void> {
        try {
          setServerInitialized(false);
          await server.stop();
        } catch {
          /* ignore */
        }
      }

      return { ready, stop };
    },
    { "server.port": options.port, "server.bindAddress": options.bindAddress || "0.0.0.0" },
  );
}

export function startProductionServer(options: ServerOptions): Promise<ServerHandle> {
  return startUniversalServer({ ...options });
}

if (import.meta.main) {
  // Register global error handlers FIRST to prevent process crashes from application errors
  // This ensures the renderer stays up even if user code throws unhandled exceptions
  onGlobalError((error, type) => {
    logger.error(`[GLOBAL] ${type}: Application error caught (process will continue)`, {
      message: error.message,
      stack: error.stack,
      type,
    });
    // Return true to prevent process exit - the renderer should stay up
    // Individual requests may fail, but the service remains available
    return true;
  });

  try {
    // Initialize OpenTelemetry tracing before starting server
    await initializeOTLPWithApis();

    // Initialize distributed caches for cross-pod cache sharing
    // Backend: API (production) > Redis (local dev) > Memory (fallback)
    await initializeDistributedCaches();

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

    const server = await startUniversalServer({
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
