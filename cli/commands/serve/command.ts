import { cwd } from "veryfront/platform";
import { gracefullyShutdownProductionServer } from "veryfront/server";
import { cliLogger } from "#cli/utils";
import { exitProcess, registerTerminationSignals, showLogo } from "#cli/utils";
import { generateDefaultProjectId } from "../../utils/project.ts";
import { startCliProductionServer } from "#cli/shared/server-startup";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";

const STARTUP_ERROR_FLUSH_TIMEOUT_MS = 2_000;

type StartupErrorReporter = {
  captureApplicationError: (
    error: unknown,
    context: { boundary: string },
  ) => string | undefined;
  flushApplicationErrors: (timeoutMs?: number) => Promise<boolean>;
  onReportingError?: (
    operation: "capture" | "flush",
    error: unknown,
  ) => void;
};

type StartupErrorReportingOptions = {
  flushTimeoutMs?: number;
};

type ProductionServerDependencies = {
  ensureBundlerContracts?: () => Promise<void>;
  initializeErrorReporting?: () => Promise<unknown>;
  reporter?: StartupErrorReporter;
};

type ServeCommandDependencies = {
  runProductionServer?: (options: ServeOptions) => Promise<void>;
};

type ProductionSentryModule = {
  captureApplicationError: StartupErrorReporter["captureApplicationError"];
  flushApplicationErrors: StartupErrorReporter["flushApplicationErrors"];
  initializeSentryFromEnv: () => Promise<unknown>;
};

export interface ServeOptions {
  mode: "combined" | "proxy" | "production";
  port: number;
  bindAddress: string;
  splitMode: boolean;
  useBinary: boolean;
  binaryPath: string;
  debug: boolean;
}

export async function runWithStartupErrorReporting<T>(
  startup: () => Promise<T>,
  reporter: StartupErrorReporter,
  options: StartupErrorReportingOptions = {},
): Promise<T> {
  const flushTimeoutMs = options.flushTimeoutMs ?? STARTUP_ERROR_FLUSH_TIMEOUT_MS;
  try {
    return await startup();
  } catch (error) {
    const reportingDeadline = Date.now() + flushTimeoutMs;
    try {
      reporter.captureApplicationError(error, { boundary: "process.startup" });
    } catch (reportingError) {
      notifyReportingError(reporter, "capture", reportingError);
    }
    try {
      await flushReporterWithDeadline(
        reporter,
        Math.max(0, reportingDeadline - Date.now()),
      );
    } catch (reportingError) {
      notifyReportingError(reporter, "flush", reportingError);
    }
    throw error;
  }
}

function notifyReportingError(
  reporter: StartupErrorReporter,
  operation: "capture" | "flush",
  error: unknown,
): void {
  try {
    reporter.onReportingError?.(operation, error);
  } catch {
    // Diagnostics must never replace the startup failure being reported.
  }
}

async function flushReporterWithDeadline(
  reporter: StartupErrorReporter,
  timeoutMs: number,
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const flush = Promise.resolve()
    .then(() => reporter.flushApplicationErrors(timeoutMs))
    .catch((error) => {
      notifyReportingError(reporter, "flush", error);
      return false;
    });
  const deadline = new Promise<boolean>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([flush, deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function runProductionStartupWithErrorReporting<T>(
  startup: () => Promise<T>,
  reporter: StartupErrorReporter,
  ensureBundlerContracts: () => Promise<void> = ensureCliBundlerContracts,
  initializeObservability: () => Promise<unknown> = () => Promise.resolve(),
): Promise<T> {
  return await runWithStartupErrorReporting(async () => {
    await initializeObservability();
    await ensureBundlerContracts();
    return await startup();
  }, reporter);
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

function createProductionStartupErrorReporter(
  sentryModule: ProductionSentryModule,
): StartupErrorReporter {
  return {
    captureApplicationError: sentryModule.captureApplicationError,
    flushApplicationErrors: sentryModule.flushApplicationErrors,
    onReportingError: (operation, error) => {
      cliLogger.warn(
        `Error reporter failed to ${operation} production startup failure.`,
      );
      cliLogger.debug(
        `Error reporter ${operation} failure details:`,
        error,
      );
    },
  };
}

export async function runProductionServer(
  options: ServeOptions,
  dependencies: ProductionServerDependencies = {},
): Promise<void> {
  showLogo();
  const sentryModule = await import("veryfront/observability/sentry");
  const reporter = dependencies.reporter ??
    createProductionStartupErrorReporter(sentryModule);

  const { server, shutdownController } = await runProductionStartupWithErrorReporting(
    async () => {
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

      return { server, shutdownController };
    },
    reporter,
    dependencies.ensureBundlerContracts ?? ensureCliBundlerContracts,
    dependencies.initializeErrorReporting ??
      (() => sentryModule.initializeSentryFromEnv()),
  );

  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await gracefullyShutdownProductionServer({
        signal,
        abort: () => shutdownController.abort(),
        stop: server.stop,
        logger: cliLogger,
      });
    } catch (error) {
      reporter.captureApplicationError(error, { boundary: "process.shutdown" });
      cliLogger.warn("Error while shutting down production server:", error);
    } finally {
      await reporter.flushApplicationErrors();
      exitProcess(0);
    }
  };

  registerTerminationSignals(shutdown);

  await new Promise(() => {});
}

export async function serveCommand(
  options: ServeOptions,
  dependencies: ServeCommandDependencies = {},
): Promise<void> {
  if (options.splitMode) {
    await runSplit(options);
    return;
  }

  if (options.mode === "proxy") {
    await runProxy(options);
    return;
  }

  if (options.mode === "production" || options.mode === "combined") {
    await (dependencies.runProductionServer ?? runProductionServer)(options);
  }
}
