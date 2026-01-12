#!/usr/bin/env -S deno run --allow-all
/**
 * Local Proxy Mode Development Launcher
 *
 * Starts both proxy (port 8080) and renderer (port 3001) for local testing.
 *
 * Usage:
 *   deno task proxy
 *   deno task proxy --project data/projects/codersociety
 *
 * Prerequisites:
 *   Copy .env.local.example to .env.local and fill in OAuth credentials
 *
 * Test:
 *   curl http://codersociety.lvh.me:8080/
 *   curl http://codersociety.lvh.me:8080/_proxy/stats
 */

const PROXY_PORT = 8080;
const RENDERER_PORT = 3003; // Match common project config (veryfront.config.ts dev.port)
const PROXY_STARTUP_DELAY_MS = 2000;

// Pass through CLI args to renderer (e.g., --project)
const cliArgs = Deno.args;

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function log(prefix: string, color: string, message: string) {
  console.log(`${color}[${prefix}]${colors.reset} ${message}`);
}

// Check for .env.local file
const envFile = ".env.local";
try {
  await Deno.stat(envFile);
} catch {
  log("ERROR", colors.red, `Missing ${envFile} file`);
  log("ERROR", colors.red, "Copy .env.local.example to .env.local and fill in credentials");
  Deno.exit(1);
}

log("PROXY", colors.cyan, `Starting proxy on port ${PROXY_PORT}...`);

const proxyProcess = new Deno.Command("deno", {
  args: ["run", "--allow-net", "--allow-env", `--env=${envFile}`, "main.ts"],
  cwd: "./proxy",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...Deno.env.toObject(),
    PORT: String(PROXY_PORT),
    RENDERER_URL: `http://localhost:${RENDERER_PORT}`,
  },
}).spawn();

// Wait for proxy to start
await new Promise((r) => setTimeout(r, PROXY_STARTUP_DELAY_MS));

const projectArg = cliArgs.includes("--project") ? ` with ${cliArgs.join(" ")}` : "";
log("RENDERER", colors.green, `Starting renderer on port ${RENDERER_PORT} (PROXY_MODE=1)${projectArg}...`);

const rendererProcess = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-all",
    "--no-lock",
    "--unstable-net",
    "--unstable-worker-options",
    "src/cli/main.ts",
    "dev",
    ...cliArgs, // Pass through CLI args (e.g., --project)
  ],
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...Deno.env.toObject(),
    PROXY_MODE: "1",
    PORT: String(RENDERER_PORT),
  },
}).spawn();

log("READY", colors.yellow, "");
log("READY", colors.yellow, "=".repeat(60));
log("READY", colors.yellow, "Local proxy mode ready!");
log("READY", colors.yellow, "");
log("READY", colors.yellow, `  Proxy:    http://localhost:${PROXY_PORT}`);
log("READY", colors.yellow, `  Renderer: http://localhost:${RENDERER_PORT} (proxy forwards to this)`);
log("READY", colors.yellow, "");
log("READY", colors.yellow, "Test URLs:");
log("READY", colors.yellow, `  http://codersociety.lvh.me:${PROXY_PORT}/`);
log("READY", colors.yellow, `  http://codersociety.lvh.me:${PROXY_PORT}/_proxy/stats`);
log("READY", colors.yellow, `  http://codersociety.lvh.me:${PROXY_PORT}/_vf_modules/pages/index.js`);
log("READY", colors.yellow, "");
log("READY", colors.yellow, "Press Ctrl+C to stop");
log("READY", colors.yellow, "=".repeat(60));

// Handle shutdown
const shutdown = () => {
  log("SHUTDOWN", colors.dim, "Stopping services...");
  try {
    proxyProcess.kill("SIGTERM");
  } catch { /* ignore */ }
  try {
    rendererProcess.kill("SIGTERM");
  } catch { /* ignore */ }
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

// Wait for either process to exit
await Promise.race([proxyProcess.status, rendererProcess.status]);
shutdown();
