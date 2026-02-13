/**
 * Split Mode Orchestration
 *
 * Runs proxy and production server as separate processes, simulating production K8s architecture.
 * Used for testing production-like behavior locally.
 */

import { cliLogger } from "#cli/utils";
import { exitProcess } from "#cli/utils";

const SERVER_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-net",
  "--allow-env",
  "--allow-run",
  "--allow-ffi",
  "--allow-sys",
] as const;

interface SplitModeOptions {
  productionServerPort: number;
  proxyPort: number;
  useBinary: boolean;
  binaryPath: string;
}

const REQUIRED_ENV_VARS = [
  "VERYFRONT_PROXY_API_BASE_URL",
  "VERYFRONT_PROXY_API_CLIENT_ID",
  "VERYFRONT_PROXY_API_CLIENT_SECRET",
  "REDIS_URL",
] as const;

const STATIC_ENV: Record<string, string> = {
  CACHE_TYPE: "redis",
  REDIS_PREFIX: "vf:token:",
  VERYFRONT_SERVER_REQUEST_TIMEOUT_MS: "90000",
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
  const { productionServerPort, proxyPort, useBinary, binaryPath } = options;

  // Validate environment
  cliLogger.info("Validating environment variables...");
  const userEnv = validateEnvVars();

  // Build child-process environment
  const env: Record<string, string> = {
    ...STATIC_ENV,
    ...userEnv,
    VERYFRONT_SERVER_URL: `http://localhost:${productionServerPort}`,
  };

  // Determine command
  const veryfront = useBinary
    ? [binaryPath]
    : ["deno", "run", ...SERVER_PERMISSIONS, "cli/main.ts"];

  // Start production server
  const productionServerProcess = startProcess(
    [...veryfront, "serve", "--mode=production", `--port=${productionServerPort}`],
    env,
    `production server on :${productionServerPort}`,
  );

  // Wait for production server
  cliLogger.info("Waiting for production server to be ready...");
  const productionServerReady = await waitForPort(productionServerPort);
  if (!productionServerReady) {
    productionServerProcess.kill("SIGTERM");
    cliLogger.error(`Production server failed to start on port ${productionServerPort}`);
    exitProcess(1);
  }
  cliLogger.info("Production server ready");

  // Start proxy
  const proxyProcess = startProcess(
    [...veryfront, "serve", "--mode=proxy", `--port=${proxyPort}`],
    env,
    `proxy on :${proxyPort}`,
  );

  cliLogger.info(`\nSplit mode running:`);
  cliLogger.info(`  Proxy:    http://localhost:${proxyPort}`);
  cliLogger.info(`  Production server: http://localhost:${productionServerPort}`);
  cliLogger.info(`\nPress Ctrl+C to stop\n`);

  // Shutdown handler
  let shutdownRequested = false;

  const shutdown = () => {
    cliLogger.info("\nShutting down...");
    try {
      proxyProcess.kill("SIGTERM");
    } catch { /* ignore */ }
    try {
      productionServerProcess.kill("SIGTERM");
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
    productionServerProcess.status.then((status) => ({ name: "production-server", status })),
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
