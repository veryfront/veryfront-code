/**
 * Serve Command Handler
 *
 * Handles the serve/preview command with support for multiple modes:
 * - renderer: SSR production server (default)
 * - proxy: Proxy-only mode
 * - split: Run proxy and renderer as separate processes
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "#veryfront/utils";
import { exitProcess, registerTerminationSignals, showLogo } from "../../utils/index.ts";
import { generateDefaultProjectId } from "../../utils/project.ts";
import type { ParsedArgs } from "../../index/types.ts";

export interface ServeOptions {
  mode: "combined" | "proxy" | "renderer";
  port: number;
  bindAddress: string;
  splitMode: boolean;
  useBinary: boolean;
  binaryPath: string;
  debug: boolean;
}

/**
 * Parse serve command arguments into options
 */
function parseServeOptions(args: ParsedArgs): ServeOptions {
  return {
    mode: (args.mode || args.m || "renderer") as "combined" | "proxy" | "renderer",
    port: args.port ?? DEFAULT_DEV_SERVER_PORT,
    bindAddress: String(args.hostname || args.host || "0.0.0.0"),
    splitMode: Boolean(args.split),
    useBinary: Boolean(args.binary),
    binaryPath: typeof args.binary === "string" ? args.binary : "./bin/veryfront",
    debug: Boolean(args.debug),
  };
}

/**
 * Run in split mode: proxy and renderer as separate processes
 */
async function runSplit(options: ServeOptions): Promise<void> {
  showLogo();
  const { runSplitMode } = await import("../serve-split.ts");

  // Use explicit ports: renderer on 3000, proxy on 8080 (or user-specified if different from default)
  const proxyPort = options.port !== DEFAULT_DEV_SERVER_PORT ? options.port : 8080;

  await runSplitMode({
    rendererPort: 3000,
    proxyPort,
    useBinary: options.useBinary,
    binaryPath: options.binaryPath,
  });
}

/**
 * Run proxy-only mode
 */
async function runProxy(options: ServeOptions): Promise<void> {
  showLogo();
  cliLogger.info(`Starting proxy server on ${options.bindAddress}:${options.port}`);

  const { setEnv } = await import("#veryfront/platform/compat/process.ts");
  setEnv("PORT", String(options.port));
  setEnv("HOST", options.bindAddress);

  // Import and run proxy main
  await import("../../../proxy/main.ts");
}

/**
 * Run renderer/combined mode (SSR production server)
 */
async function runRenderer(options: ServeOptions): Promise<void> {
  showLogo();

  // Clear stale ESM caches to prevent module resolution issues
  const { clearAllLocalCaches } = await import(
    "../../../transforms/mdx/esm-module-loader/cache/index.ts"
  );
  await clearAllLocalCaches();

  const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
  const adapter = await runtime.get();
  const { startUniversalServer } = await import("#veryfront/server/production-server.ts");

  // Initialize OTLP tracing and distributed caches before starting server
  const { initializeOTLPWithApis } = await import(
    "#veryfront/observability/tracing/otlp-setup.ts"
  );
  const { initializeDistributedCaches } = await import(
    "#veryfront/cache/distributed-cache-init.ts"
  );
  await Promise.allSettled([
    initializeOTLPWithApis(),
    initializeDistributedCaches(),
  ]);

  const projectDir = cwd();
  const shutdownController = new AbortController();

  // Generate default project ID for local filesystem mode
  const defaultProjectId = generateDefaultProjectId(projectDir);

  const server = await startUniversalServer({
    projectDir,
    port: options.port,
    bindAddress: options.bindAddress,
    debug: options.debug,
    adapter,
    signal: shutdownController.signal,
    defaultProjectSlug: defaultProjectId,
    defaultProjectId,
  });
  await server.ready;

  // Setup graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    cliLogger.info(`Received ${signal}, shutting down production server...`);
    try {
      shutdownController.abort();
      await server.stop();
    } catch (error) {
      cliLogger.warn("Error while shutting down production server:", error);
    } finally {
      exitProcess(0);
    }
  };

  registerTerminationSignals((signal) => {
    void shutdown(signal);
  });

  // Keep the process running
  await new Promise(() => {
    /* never resolve */
  });
}

/**
 * Handle the serve/preview command
 */
export async function handleServeCommand(args: ParsedArgs): Promise<void> {
  const options = parseServeOptions(args);

  // Split mode: run proxy and renderer as separate processes
  if (options.splitMode) {
    await runSplit(options);
    return;
  }

  // Proxy-only mode
  if (options.mode === "proxy") {
    await runProxy(options);
    return;
  }

  // Renderer or combined mode
  if (options.mode === "renderer" || options.mode === "combined") {
    await runRenderer(options);
  }
}
