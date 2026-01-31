#!/usr/bin/env -S deno run --allow-all
/**
 * Start split mode for local debugging - pure Deno implementation.
 *
 * Usage: deno task start-split [--deno]
 *   --deno  Use deno run instead of compiled binary
 *
 * Required environment variables (set in .env or shell):
 *   VERYFRONT_API_BASE_URL       - API server URL
 *   API_CLIENT_ID                - OAuth client ID for renderer proxy
 *   API_CLIENT_SECRET            - OAuth client secret for renderer proxy
 *   REDIS_URL                    - Redis connection URL
 *
 * Optional environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  - OpenTelemetry endpoint for tracing
 *   OTEL_EXPORTER_OTLP_HEADERS   - Auth headers for OTLP endpoint
 *   VERYFRONT_BINARY_FRESH=1     - Force recompile binary even if source unchanged
 */

import { load } from "https://deno.land/std@0.220.0/dotenv/mod.ts";

// Load .env file (don't enforce .env.example requirements)
await load({ export: true, allowEmptyValues: true, examplePath: null });

// Required env vars - script exits with error if missing
const REQUIRED_ENV_VARS = [
  "VERYFRONT_API_BASE_URL",
  "API_CLIENT_ID",
  "API_CLIENT_SECRET",
  "REDIS_URL",
] as const;

// Optional env vars with their defaults
const OPTIONAL_ENV_VARS: Record<string, string | undefined> = {
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
  OTEL_EXPORTER_OTLP_HEADERS: undefined,
  OTEL_SERVICE_NAME: "veryfront-split-mode",
  OTEL_TRACES_ENABLED: "false",
};

// Static configuration
const STATIC_CONFIG: Record<string, string> = {
  RENDERER_URL: "http://localhost:3000",
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

function error(message: string): never {
  console.error(`\n\x1b[31m✗ ${message}\x1b[0m\n`);
  Deno.exit(1);
}

function validateEnvVars(): Record<string, string> {
  console.log("Validating environment variables...\n");

  const missing: string[] = [];
  const env: Record<string, string> = {};

  // Check required vars
  for (const name of REQUIRED_ENV_VARS) {
    const value = Deno.env.get(name);
    if (!value) {
      missing.push(name);
      console.error(`  \x1b[31m✗ ${name}\x1b[0m - required, not set`);
    } else {
      env[name] = value;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    }
  }

  // Check optional vars
  for (const [name, defaultValue] of Object.entries(OPTIONAL_ENV_VARS)) {
    const value = Deno.env.get(name) ?? defaultValue;
    if (value) {
      env[name] = value;
      const source = Deno.env.get(name) ? "" : " (default)";
      console.log(`  \x1b[32m✓\x1b[0m ${name}${source}`);
    } else {
      console.log(`  \x1b[33m○\x1b[0m ${name} - optional, not set`);
    }
  }

  if (missing.length > 0) {
    error(
      `Missing required environment variables:\n\n` +
        missing.map((v) => `  export ${v}="..."`).join("\n") +
        `\n\nSet these variables and try again.`,
    );
  }

  console.log("");
  return env;
}

const BINARY_PATH = "./bin/veryfront";
const BINARY_HASH_PATH = "./bin/.source-hash";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function computeSourceHash(): Promise<string> {
  const decoder = new TextDecoder();

  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD:src"],
      stdout: "piped",
      stderr: "null",
    }).output();

    if (result.success) return decoder.decode(result.stdout).trim();
  } catch {
    // fall through
  }

  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    }).output();

    if (result.success) return decoder.decode(result.stdout).trim();
  } catch {
    // fall through
  }

  return Date.now().toString();
}

async function ensureBinaryCompiled(): Promise<void> {
  const forceFresh = Deno.env.get("VERYFRONT_BINARY_FRESH") === "1";
  const binaryExists = await exists(BINARY_PATH);
  const currentHash = await computeSourceHash();

  if (binaryExists && !forceFresh) {
    try {
      const storedHash = await Deno.readTextFile(BINARY_HASH_PATH);
      if (storedHash.trim() === currentHash) {
        console.log("Using existing binary (source unchanged)");
        return;
      }
      console.log("Source changed, recompiling...");
    } catch {
      console.log("No source hash found, recompiling...");
    }
  } else if (forceFresh) {
    console.log("Force fresh build (VERYFRONT_BINARY_FRESH=1)");
  } else {
    console.log("Binary not found, compiling...");
  }

  if (binaryExists) await Deno.remove(BINARY_PATH);

  const cmd = new Deno.Command("deno", {
    args: ["task", "build"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await cmd.output();
  if (!success) error("Failed to compile binary");

  await Deno.writeTextFile(BINARY_HASH_PATH, currentHash);
  console.log("Binary compiled successfully");
}

function startServer(
  cmd: string[],
  env: Record<string, string>,
  name: string,
): Deno.ChildProcess {
  console.log(`Starting ${name}...`);

  const [executable, ...args] = cmd;
  return new Deno.Command(executable, {
    args,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
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

async function main(): Promise<void> {
  const useDeno = Deno.args.includes("--deno");
  const projectRoot = new URL("../..", import.meta.url).pathname;

  Deno.chdir(projectRoot);

  // VALIDATION FIRST - fail early if env vars are missing
  const userEnv = validateEnvVars();

  // Map OAuth env vars to expected names (legacy compatibility)
  const env: Record<string, string> = {
    ...STATIC_CONFIG,
    ...userEnv,
    API_CLIENT_ID_VERYFRONT_RENDERER_PROXY: userEnv.API_CLIENT_ID,
    API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY: userEnv.API_CLIENT_SECRET,
    OTEL_RESOURCE_ATTRIBUTES: `host.name=${Deno.hostname()}`,
  };

  // Determine command to use
  let veryfront: string[];
  if (useDeno) {
    veryfront = ["deno", "run", "--allow-all", "src/cli/main.ts"];
  } else {
    await ensureBinaryCompiled();
    veryfront = [BINARY_PATH];
  }

  // Start renderer
  const rendererProcess = startServer(
    [...veryfront, "serve", "--mode=renderer", "--port=3000"],
    env,
    "renderer on :3000",
  );

  // Wait for renderer to be ready
  console.log("Waiting for renderer...");
  const rendererReady = await waitForPort(3000);
  if (!rendererReady) {
    rendererProcess.kill("SIGTERM");
    error("Renderer failed to start on port 3000");
  }
  console.log("  ✓ Renderer ready");

  // Start proxy
  const proxyProcess = startServer(
    [...veryfront, "serve", "--mode=proxy", "--port=8080"],
    env,
    "proxy on :8080",
  );

  console.log("\n\x1b[32m✓ Split mode running\x1b[0m");
  console.log("  Proxy:    http://localhost:8080");
  console.log("  Renderer: http://localhost:3000");
  console.log("\nPress Ctrl+C to stop\n");

  // Handle shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    try {
      proxyProcess.kill("SIGTERM");
    } catch { /* ignore */ }
    try {
      rendererProcess.kill("SIGTERM");
    } catch { /* ignore */ }
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  // Wait for either process to exit
  await Promise.race([
    rendererProcess.status,
    proxyProcess.status,
  ]);

  shutdown();
}

main().catch((err) => {
  console.error(err);
  Deno.exit(1);
});
