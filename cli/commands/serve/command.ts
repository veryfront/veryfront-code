import { cwd } from "veryfront/platform";
import { cliLogger } from "#cli/utils";
import { exitProcess, registerTerminationSignals, showLogo } from "#cli/utils";
import { generateDefaultProjectId } from "../../utils/project.ts";
import { startCliProductionServer } from "#cli/shared/server-startup";

export interface ServeOptions {
  mode: "combined" | "proxy" | "production";
  port: number;
  bindAddress: string;
  splitMode: boolean;
  useBinary: boolean;
  binaryPath: string;
  debug: boolean;
}

async function runSplit(options: ServeOptions): Promise<void> {
  showLogo();
  const { runSplitMode } = await import("./split-mode.ts");

  const { DEFAULT_DEV_SERVER_PORT } = await import("#cli/utils");
  const proxyPort = options.port !== DEFAULT_DEV_SERVER_PORT ? options.port : 8080;

  await runSplitMode({
    productionServerPort: 3000,
    proxyPort,
    useBinary: options.useBinary,
    binaryPath: options.binaryPath,
  });
}

async function runProxy(options: ServeOptions): Promise<void> {
  showLogo();
  cliLogger.info(`Starting proxy server on ${options.bindAddress}:${options.port}`);

  const { setEnv } = await import("veryfront/platform");
  setEnv("PORT", String(options.port));
  setEnv("HOST", options.bindAddress);

  // DenoHttpServer.serve() blocks until the server stops,
  // so this import keeps the process alive.
  await import("veryfront/proxy/main");

  // Keep the process alive (Deno.serve returns immediately in compiled binaries)
  await new Promise(() => {});
}

async function runProductionServer(options: ServeOptions): Promise<void> {
  showLogo();

  const { clearAllLocalCaches } = await import(
    "veryfront/transforms/mdx-cache"
  );
  await clearAllLocalCaches();

  const { initializeOTLPWithApis } = await import(
    "veryfront/observability/otlp-setup"
  );
  const { initializeDistributedCaches } = await import(
    "veryfront/cache"
  );
  await Promise.allSettled([
    initializeOTLPWithApis(),
    initializeDistributedCaches(),
  ]);

  const projectDir = cwd();
  const shutdownController = new AbortController();

  const defaultProjectId = generateDefaultProjectId(projectDir);

  const server = await startCliProductionServer({
    projectDir,
    port: options.port,
    bindAddress: options.bindAddress,
    debug: options.debug,
    signal: shutdownController.signal,
    defaultProjectSlug: defaultProjectId,
    defaultProjectId,
  });
  await server.ready;

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

  await new Promise(() => {});
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  if (options.splitMode) {
    await runSplit(options);
    return;
  }

  if (options.mode === "proxy") {
    await runProxy(options);
    return;
  }

  if (options.mode === "production" || options.mode === "combined") {
    await runProductionServer(options);
  }
}
