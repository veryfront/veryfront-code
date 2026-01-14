#!/usr/bin/env -S deno run --allow-all
/**
 * Local Proxy + Renderer launcher
 * Usage: deno task proxy [--project path/to/project]
 */

const PROXY_PORT = 8080;
const RENDERER_PORT = 3001;

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
};

function isTty(): boolean {
  try {
    return Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

function shouldUseColor(): boolean {
  const env = Deno.env.toObject();
  if (env.FORCE_COLOR === "0" || env.NO_COLOR !== undefined) return false;
  return isTty();
}

function c(color: string, text: string): string {
  return shouldUseColor() ? `${color}${text}${ANSI.reset}` : text;
}

// Check .env exists
try {
  await Deno.stat(".env");
} catch {
  console.error(c(ANSI.dim, "error:"), "Missing .env - copy from .env.example");
  Deno.exit(1);
}

// Start proxy (info level to show request logs)
const proxyEnv = {
  ...Deno.env.toObject(),
  PORT: String(PROXY_PORT),
  RENDERER_URL: `http://localhost:${RENDERER_PORT}`,
  LOG_LEVEL: "info",
};

const proxy = new Deno.Command("deno", {
  args: ["run", "--allow-net", "--allow-env", "--env=../.env", "main.ts"],
  cwd: "./proxy",
  stdout: "inherit",
  stderr: "inherit",
  env: proxyEnv,
}).spawn();

await new Promise((r) => setTimeout(r, 1000));

// Start renderer (warn level to reduce noise)
const renderer = new Deno.Command("deno", {
  args: ["run", "--allow-all", "--unstable-net", "--unstable-worker-options", "src/cli/main.ts", "dev", ...Deno.args],
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...Deno.env.toObject(),
    PROXY_MODE: "1",
    PORT: String(RENDERER_PORT),
    LOG_LEVEL: "warn",
    REQUEST_TIMEOUT_MS: "60000", // 60s for cold start initialization
  },
}).spawn();

// Wait for services to initialize
await new Promise((r) => setTimeout(r, 2000));

// Clean startup banner
console.log();
console.log(c(ANSI.dim, "─".repeat(40)));
console.log(`  ${c(ANSI.bold + ANSI.cyan, "Veryfront")} ${c(ANSI.dim, "Multi-Project Mode")}`);
console.log(c(ANSI.dim, "─".repeat(40)));
console.log();
console.log(`  ${c(ANSI.green, "●")} Open: ${c(ANSI.cyan, `http://{project}.lvh.me:${PROXY_PORT}/`)}`);
console.log();
console.log(`  ${c(ANSI.dim, "Example:")} ${c(ANSI.cyan, `http://blank.lvh.me:${PROXY_PORT}/`)}`);
console.log();
console.log(c(ANSI.dim, `  Press Ctrl+C to stop`));
console.log();

// Shutdown handler
const shutdown = () => {
  console.log();
  console.log(c(ANSI.dim, "  Shutting down..."));
  try { proxy.kill("SIGTERM"); } catch { /* ignore */ }
  try { renderer.kill("SIGTERM"); } catch { /* ignore */ }
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

await Promise.race([proxy.status, renderer.status]);
shutdown();
