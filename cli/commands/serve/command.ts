import { cwd } from "veryfront/platform";
import { gracefullyShutdownProductionServer } from "veryfront/server";
import { cliLogger } from "#cli/utils";
import { exitProcess, registerTerminationSignals, showHeader } from "#cli/utils";
import { generateDefaultProjectId } from "../../utils/project.ts";
import { startCliProductionServer } from "#cli/shared/server-startup";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";
import { isJsonMode } from "../../shared/json-output.ts";
import { brand, success } from "../../ui/colors.ts";
import { runStandaloneProxyRuntime } from "./proxy-runtime.ts";

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
  loadSentryModule?: () => Promise<ProductionSentryModule>;
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
  showHeader();
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
  await runStandaloneProxyRuntime({
    bindAddress: options.bindAddress,
    port: options.port,
  });
}

function createDeferredProductionStartupErrorReporter(): {
  reporter: StartupErrorReporter;
  setSentryModule: (sentryModule: ProductionSentryModule) => void;
} {
  let sentryModule: ProductionSentryModule | undefined;

  return {
    reporter: {
      // If Sentry module acquisition fails, no remote transport exists yet.
      // Preserve the acquisition failure and bound flush instead of adding a
      // fallback reporter inside the startup path.
      captureApplicationError: (error, context) =>
        sentryModule?.captureApplicationError(error, context),
      flushApplicationErrors: (timeoutMs) =>
        sentryModule?.flushApplicationErrors(timeoutMs) ?? Promise.resolve(true),
      onReportingError: (operation, error) => {
        cliLogger.warn(
          `Error reporter failed to ${operation} production startup failure.`,
        );
        cliLogger.debug(
          `Error reporter ${operation} failure details:`,
          error,
        );
      },
    },
    setSentryModule: (loadedSentryModule) => {
      sentryModule = loadedSentryModule;
    },
  };
}

function loadProductionSentryModule(): Promise<ProductionSentryModule> {
  // Process-wide Sentry initialization stays on an internal CLI-only import.
  // The public observability surface exposes only capture and flush.
  return Promise.all([
    import("#cli/production-error-reporting"),
    import("veryfront/observability"),
  ]).then(([reportingModule, observabilityModule]) => ({
    captureApplicationError: observabilityModule.captureApplicationError,
    flushApplicationErrors: observabilityModule.flushApplicationErrors,
    initializeSentryFromEnv: reportingModule.initializeProductionErrorReportingFromEnv,
  }));
}

const WILDCARD_BIND_ADDRESSES = new Set(["", "0.0.0.0", "::", "[::]"]);

/**
 * Browsable URL for a server bound to `bindAddress`.
 *
 * A wildcard bind is not an address a developer can open, so it is rendered as
 * `localhost` — the host the deploy docs tell them to visit.
 */
export function serveReadyUrl(bindAddress: string, port: number): string {
  const host = WILDCARD_BIND_ADDRESSES.has(bindAddress) ? "localhost" : bindAddress;
  const bracketed = host.startsWith("[") && host.endsWith("]");
  const formattedHost = !bracketed && host.includes(":") ? `[${host}]` : host;
  return `http://${formattedHost}:${port}`;
}

/**
 * Print the ready block with the URL to open, mirroring `veryfront dev`.
 *
 * Port `0` asks the OS for an ephemeral port, so the requested port is not the
 * port that was bound and there is no browsable URL to print here — the bound
 * port is only known to the server's `onListen`, which already logs it as
 * `Production server listening`. Printing `http://localhost:0` under it would
 * contradict the one correct line on screen, so the block is skipped instead.
 */
export function printServeReady(options: { port: number; bindAddress: string }): void {
  if (isJsonMode()) return;
  if (options.port === 0) return;
  console.log();
  console.log(`  ${success("✓")} Ready`);
  console.log(`  ${brand(serveReadyUrl(options.bindAddress, options.port))}`);
  console.log();
}

export async function runProductionServer(
  options: ServeOptions,
  dependencies: ProductionServerDependencies = {},
): Promise<void> {
  showHeader();
  const deferredReporter = createDeferredProductionStartupErrorReporter();
  const reporter = dependencies.reporter ?? deferredReporter.reporter;
  const initializeErrorReporting = dependencies.initializeErrorReporting ??
    (async () => {
      const sentryModule = await (
        dependencies.loadSentryModule ?? loadProductionSentryModule
      )();
      deferredReporter.setSentryModule(sentryModule);
      await sentryModule.initializeSentryFromEnv();
    });

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
    initializeErrorReporting,
  );

  printServeReady({ port: options.port, bindAddress: options.bindAddress });

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
