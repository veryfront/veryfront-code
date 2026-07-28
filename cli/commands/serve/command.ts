import { cwd } from "veryfront/platform";
import { gracefullyShutdownProductionServer } from "veryfront/server";
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

/** @internal Process terminal used by the production serve command. */
export function createCliProductionShutdownHandler(options: {
  readonly performShutdown: (signal: "SIGINT" | "SIGTERM") => void | Promise<unknown>;
  readonly captureApplicationError: (
    error: unknown,
    context: { boundary: string },
  ) => unknown;
  readonly flushApplicationErrors: () => void | Promise<unknown>;
  readonly exitProcess: (code: number) => void;
  readonly logger: { warn: (...args: unknown[]) => void };
}): (signal: "SIGINT" | "SIGTERM") => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return (signal) => {
    if (shutdownPromise) return shutdownPromise;

    const attempt = Promise.resolve().then(async () => {
      let exitCode = 0;
      try {
        await options.performShutdown(signal);
      } catch (error) {
        exitCode = 1;
        options.captureApplicationError(error, { boundary: "process.shutdown" });
        options.logger.warn("Error while shutting down production server:", error);
      }

      try {
        const flushed = await options.flushApplicationErrors();
        if (flushed === false) {
          const error = new Error("Application error diagnostics did not flush completely");
          exitCode = 1;
          options.captureApplicationError(error, { boundary: "process.shutdown.flush" });
          options.logger.warn("Error while flushing shutdown diagnostics:", error);
        }
      } catch (error) {
        exitCode = 1;
        options.captureApplicationError(error, { boundary: "process.shutdown.flush" });
        options.logger.warn("Error while flushing shutdown diagnostics:", error);
      }

      options.exitProcess(exitCode);
    });
    shutdownPromise = attempt;
    return attempt;
  };
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

  const {
    captureApplicationError,
    flushApplicationErrors,
    initializeSentryFromEnv,
  } = await import("veryfront/observability/sentry");
  await initializeSentryFromEnv();

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
  const { defaultDistributedCacheInitializers } = await import(
    "veryfront/server"
  );
  await Promise.allSettled([
    initializeOTLPWithApis(),
    initializeDistributedCaches(defaultDistributedCacheInitializers),
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

  const shutdown = createCliProductionShutdownHandler({
    performShutdown: (signal) =>
      gracefullyShutdownProductionServer({
        signal,
        abort: () => shutdownController.abort(),
        stop: server.stop,
        logger: cliLogger,
      }),
    captureApplicationError,
    flushApplicationErrors,
    exitProcess,
    logger: cliLogger,
  });

  registerTerminationSignals(shutdown);

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
