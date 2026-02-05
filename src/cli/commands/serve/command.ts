import { cwd } from "#veryfront/platform/compat/process.ts";
import { cliLogger } from "#veryfront/utils";
import { exitProcess, registerTerminationSignals, showLogo } from "../../utils/index.ts";
import { generateDefaultProjectId } from "../../utils/project.ts";

export interface ServeOptions {
  mode: "combined" | "proxy" | "renderer";
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

  const { DEFAULT_DEV_SERVER_PORT } = await import("#veryfront/utils");
  const proxyPort = options.port !== DEFAULT_DEV_SERVER_PORT ? options.port : 8080;

  await runSplitMode({
    rendererPort: 3000,
    proxyPort,
    useBinary: options.useBinary,
    binaryPath: options.binaryPath,
  });
}

async function runProxy(options: ServeOptions): Promise<void> {
  showLogo();
  cliLogger.info(`Starting proxy server on ${options.bindAddress}:${options.port}`);

  const { setEnv } = await import("#veryfront/platform/compat/process.ts");
  setEnv("PORT", String(options.port));
  setEnv("HOST", options.bindAddress);

  await import("../../../proxy/main.ts");
}

async function runRenderer(options: ServeOptions): Promise<void> {
  showLogo();

  const { clearAllLocalCaches } = await import(
    "../../../transforms/mdx/esm-module-loader/cache/index.ts"
  );
  await clearAllLocalCaches();

  const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
  const adapter = await runtime.get();
  const { startUniversalServer } = await import("#veryfront/server/production-server.ts");

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

  if (options.mode === "renderer" || options.mode === "combined") {
    await runRenderer(options);
  }
}
