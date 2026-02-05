/**
 * Split Mode Orchestration
 *
 * Runs proxy and renderer as separate processes, simulating production K8s architecture.
 * Used for testing production-like behavior locally.
 */

import { cliLogger } from "#veryfront/utils";
import { exitProcess } from "../../utils/index.ts";

interface SplitModeOptions {
  rendererPort: number;
  proxyPort: number;
  useBinary: boolean;
  binaryPath: string;
}

const REQUIRED_ENV_VARS = [
  "VERYFRONT_API_BASE_URL",
  "API_CLIENT_ID",
  "API_CLIENT_SECRET",
  "REDIS_URL",
] as const;

const STATIC_ENV: Record<string, string> = {
  CACHE_TYPE: "redis",
  REDIS_PREFIX: "vf:token:",
  RENDERER_REQUEST_TIMEOUT_MS: "90000",
  NODE_ENV: "production",
  PROXY_MODE: "1",
  PRODUCTION_MODE: "1",
  SSR_REDIS_CACHE_ENABLED: "true",
  PROJECT_MAX_CONCURRENT: "1000",
  PROJECT_CIRCUIT_THRESHOLD: "20",
  PROJECT_CIRCUIT_RESET_MS: "15000",
};

function validateEnvVars(): Record<string, string> {
  const missing: string[] = [];
  const env: Record<string, string> = {};

  for (const name of REQUIRED_ENV_VARS) {
    const value = Deno.env.get(name);
    if (!value) {
      missing.push(name);
    } else {
      env[name] = value;
    }
  }

  if (missing.length > 0) {
    cliLogger.error(`Missing required environment variables for split mode:`);
    for (const name of missing) {
      cliLogger.error(`  - ${name}`);
    }
    cliLogger.info(`\nSet these variables in .env or shell and try again.`);
    exitProcess(1);
  }

  return env;
}

async function waitForPort(port: number, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      conn.close();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
}

function startProcess(
  cmd: string[],
  env: Record<string, string>,
  name: string,
): Deno.ChildProcess {
  cliLogger.info(`Starting ${name}...`);
  const [executable, ...args] = cmd;
  return new Deno.Command(executable!, {
    args,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
}

export async function runSplitMode(options: SplitModeOptions): Promise<void> {
  const { rendererPort, proxyPort, useBinary, binaryPath } = options;

  // Validate environment
  cliLogger.info("Validating environment variables...");
  const userEnv = validateEnvVars();

  // Build environment with OAuth mapping
  const env: Record<string, string> = {
    ...STATIC_ENV,
    ...userEnv,
    RENDERER_URL: `http://localhost:${rendererPort}`,
    API_CLIENT_ID_VERYFRONT_RENDERER_PROXY: userEnv.API_CLIENT_ID!,
    API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY: userEnv.API_CLIENT_SECRET!,
  };

  // Determine command
  const veryfront = useBinary ? [binaryPath] : ["deno", "run", "--allow-all", "src/cli/main.ts"];

  // Start renderer
  const rendererProcess = startProcess(
    [...veryfront, "serve", "--mode=renderer", `--port=${rendererPort}`],
    env,
    `renderer on :${rendererPort}`,
  );

  // Wait for renderer
  cliLogger.info("Waiting for renderer to be ready...");
  const rendererReady = await waitForPort(rendererPort);
  if (!rendererReady) {
    rendererProcess.kill("SIGTERM");
    cliLogger.error(`Renderer failed to start on port ${rendererPort}`);
    exitProcess(1);
  }
  cliLogger.info("Renderer ready");

  // Start proxy
  const proxyProcess = startProcess(
    [...veryfront, "serve", "--mode=proxy", `--port=${proxyPort}`],
    env,
    `proxy on :${proxyPort}`,
  );

  cliLogger.info(`\nSplit mode running:`);
  cliLogger.info(`  Proxy:    http://localhost:${proxyPort}`);
  cliLogger.info(`  Renderer: http://localhost:${rendererPort}`);
  cliLogger.info(`\nPress Ctrl+C to stop\n`);

  // Shutdown handler
  let shutdownRequested = false;

  const shutdown = () => {
    cliLogger.info("\nShutting down...");
    try {
      proxyProcess.kill("SIGTERM");
    } catch { /* ignore */ }
    try {
      rendererProcess.kill("SIGTERM");
    } catch { /* ignore */ }
  };

  const handleSignal = () => {
    shutdownRequested = true;
    shutdown();
  };

  Deno.addSignalListener("SIGINT", handleSignal);
  Deno.addSignalListener("SIGTERM", handleSignal);

  // Wait for either process to exit
  const firstExit = await Promise.race([
    rendererProcess.status.then((status) => ({ name: "renderer", status })),
    proxyProcess.status.then((status) => ({ name: "proxy", status })),
  ]);

  shutdown();

  const exitCode = shutdownRequested
    ? 0
    : firstExit.status.success
    ? 1
    : firstExit.status.code ?? 1;

  if (!shutdownRequested) {
    cliLogger.error(
      `${firstExit.name} exited with code ${firstExit.status.code ?? "unknown"}`,
    );
  }

  exitProcess(exitCode);
}
