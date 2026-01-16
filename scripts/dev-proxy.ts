#!/usr/bin/env -S deno run --allow-all
/**
 * Local Proxy + Renderer launcher
 * Usage: deno task dev [--single] [--project path/to/project]
 *
 * --single: Run in single-project mode (uses env vars for project)
 */

import { banner } from "../src/cli/ui/components/banner.ts";
import { brand, dim, success, error } from "../src/cli/ui/colors.ts";
import { createKeyboardHandler } from "../src/cli/ui/keyboard.ts";
import { openBrowser } from "../src/cli/auth/browser.ts";

// Parse port from args (-p or --port)
function parsePort(): number {
  const args = Deno.args;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p" || args[i] === "--port") {
      const port = parseInt(args[i + 1] || "", 10);
      if (!isNaN(port)) return port;
    }
    if (args[i]?.startsWith("-p=") || args[i]?.startsWith("--port=")) {
      const port = parseInt(args[i].split("=")[1] || "", 10);
      if (!isNaN(port)) return port;
    }
  }
  return 8080; // default
}

const PROXY_PORT = parsePort();
const RENDERER_PORT = PROXY_PORT + 1; // renderer runs on port+1

// Clear module caches on startup to prevent stale transform issues
// See: https://github.com/veryfront/veryfront-renderer/issues/79
async function clearModuleCaches(): Promise<void> {
  const cacheDirs = [".cache/veryfront-mdx-esm", ".cache/veryfront-modules"];
  for (const dir of cacheDirs) {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // Directory doesn't exist, ignore
    }
  }
}

// Check for --single flag
const args = Deno.args.filter(arg => arg !== "--single");
const isSingleMode = Deno.args.includes("--single");

if (isSingleMode) {
  // Run single-project mode directly
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "--unstable-net", "--unstable-worker-options", "src/cli/main.ts", "dev", ...args],
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...Deno.env.toObject(),
      LOG_LEVEL: "error", // Suppress startup noise
    },
  }).spawn();

  const status = await proc.status;
  Deno.exit(status.code);
}

// Check .env exists for multi-project mode
try {
  await Deno.stat(".env");
} catch {
  console.error(error("error:"), "Missing .env - copy from .env.example");
  Deno.exit(1);
}

// Clear stale module caches on startup
await clearModuleCaches();

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
  args: ["run", "--allow-all", "--unstable-net", "--unstable-worker-options", "src/cli/main.ts", "dev", ...args],
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

const serverUrl = `http://lvh.me:${PROXY_PORT}`;

// Startup banner with dot matrix logo
console.log();
console.log(banner({
  title: "Veryfront",
  subtitle: "is now running",
  info: {
    url: serverUrl,
  },
}));
console.log();
console.log(`  ${success("✓")} Server ready`);
console.log();
console.log(`  ${dim("Shortcuts:")}`);
console.log(`    ${brand("o")}  ${dim("open in browser")}`);
console.log(`    ${brand("c")}  ${dim("clear console")}`);
console.log(`    ${brand("q")}  ${dim("quit")}`);
console.log();

// Shutdown handler
const shutdown = () => {
  keyboardHandler.stop();
  console.log();
  console.log(dim("  Shutting down..."));
  try { proxy.kill("SIGTERM"); } catch { /* ignore */ }
  try { renderer.kill("SIGTERM"); } catch { /* ignore */ }
  Deno.exit(0);
};

// Set up keyboard shortcuts
const keyboardHandler = createKeyboardHandler({
  onOpen: () => void openBrowser(serverUrl),
  onClear: () => console.clear(),
  onQuit: shutdown,
});
keyboardHandler.start();

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

await Promise.race([proxy.status, renderer.status]);
shutdown();
