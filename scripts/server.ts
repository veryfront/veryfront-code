#!/usr/bin/env -S deno run --allow-all
/**
 * Veryfront Server
 *
 * Starts proxy + renderer in a single process.
 *
 * Usage:
 *   deno task start                     # Start server with interactive TUI
 *   deno task start --project <path>    # Set default project
 *   deno task start -p 8080             # Custom port
 *   deno task start --headless          # No TUI (for coding agents)
 *
 * Access:
 *   http://localhost:8080               # Default project (if --project specified)
 *   http://<slug>.lvh.me:8080           # Any project by slug
 *
 * Projects are served from:
 *   1. Local filesystem (auto-discovered from data/projects/, projects/, examples/)
 *   2. Veryfront API (fallback, requires .env credentials)
 *
 * For split mode (separate processes):
 *   - deno task proxy
 *   - deno task renderer
 */

import { join, resolve } from "@std/path";
import { requestTracker } from "../src/server/universal-handler/request-tracker.ts";

// Types
interface Args {
  port: number;
  projectPath: string | null;
  mcpPort: number;
  headless: boolean;
}

interface LocalProjects {
  projects: Map<string, string>;
  examples: Map<string, string>;
  default: string | null;
}

// Parse CLI arguments
function parseArgs(): Args {
  const args = Deno.args;
  let port = 8080;
  let projectPath: string | null = null;
  let mcpPort = 9999; // MCP HTTP enabled by default
  let headless = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-p" || arg === "--port") {
      port = parseInt(args[i + 1] || "", 10) || 8080;
      i++;
    } else if (arg.startsWith("-p=") || arg.startsWith("--port=")) {
      port = parseInt(arg.split("=")[1] || "", 10) || 8080;
    }

    if (arg === "--project") {
      projectPath = args[i + 1] || null;
      i++;
    } else if (arg.startsWith("--project=")) {
      projectPath = arg.split("=")[1] || null;
    }

    // Custom MCP port
    if (arg === "--mcp-port") {
      mcpPort = parseInt(args[i + 1] || "", 10) || 9999;
      i++;
    } else if (arg.startsWith("--mcp-port=")) {
      mcpPort = parseInt(arg.split("=")[1] || "", 10) || 9999;
    }

    // Headless mode (no TUI)
    if (arg === "--headless" || arg === "--no-tui") {
      headless = true;
    }
  }

  return { port, projectPath, mcpPort, headless };
}

// Check if a directory exists
async function directoryExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

// Check if a port is available
async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const listener = Deno.listen({ port });
    listener.close();
    return true;
  } catch {
    return false;
  }
}

// Check required ports and exit with friendly message if unavailable
async function checkPorts(port: number): Promise<void> {
  const mainPortFree = await isPortAvailable(port);
  const hmrPortFree = await isPortAvailable(port + 1);

  if (!mainPortFree || !hmrPortFree) {
    const blockedPort = !mainPortFree ? port : port + 1;
    console.error(`\n\x1b[31mError: Port ${blockedPort} is already in use.\x1b[0m`);
    console.error(`\nTo fix this, either:`);
    console.error(`  1. Kill the existing process: \x1b[36mlsof -ti:${blockedPort} | xargs kill -9\x1b[0m`);
    console.error(`  2. Use a different port: \x1b[36mdeno task start -p ${port + 100}\x1b[0m\n`);
    Deno.exit(1);
  }
}

// Get project slug from path (last directory name)
function getProjectSlug(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized.split("/").pop() || "";
}

// Find all local project directories
async function findLocalProjects(baseDirs: string[]): Promise<Map<string, string>> {
  const projects = new Map<string, string>();

  for (const baseDir of baseDirs) {
    if (!await directoryExists(baseDir)) continue;

    for await (const entry of Deno.readDir(baseDir)) {
      if (entry.isDirectory && !entry.name.startsWith(".")) {
        const projectPath = join(baseDir, entry.name);
        const hasApp = await directoryExists(join(projectPath, "app"));
        const hasPages = await directoryExists(join(projectPath, "pages"));
        const hasComponents = await directoryExists(join(projectPath, "components"));
        if (hasApp || hasPages || hasComponents) {
          // Convert to absolute path for consistent path resolution across the system
          const absolutePath = resolve(projectPath);
          projects.set(entry.name, absolutePath);
        }
      }
    }
  }

  return projects;
}

// Clear module caches on startup
async function clearModuleCaches(): Promise<void> {
  const cacheDirs = [".cache/veryfront-mdx-esm", ".cache/veryfront-modules"];
  for (const dir of cacheDirs) {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // Directory doesn't exist
    }
  }
}

// Check if .env exists
async function hasEnvFile(): Promise<boolean> {
  try {
    await Deno.stat(".env");
    return true;
  } catch {
    return false;
  }
}

// Discover local projects and examples separately
async function discoverLocalProjects(projectPath: string | null): Promise<LocalProjects> {
  // Projects from data/projects and projects directories
  const projects = await findLocalProjects(["data/projects", "projects"]);

  // Examples from examples directory
  const examples = await findLocalProjects(["examples"]);

  let defaultProject: string | null = null;

  if (projectPath && await directoryExists(projectPath)) {
    const slug = getProjectSlug(projectPath);
    // Convert to absolute path for consistent path resolution
    projects.set(slug, resolve(projectPath));
    defaultProject = slug;
  }

  return { projects, examples, default: defaultProject };
}

// Main
async function main(): Promise<void> {
  const args = parseArgs();

  // Load .env FIRST so LOG_LEVEL can be set there
  const hasCredentials = await hasEnvFile();
  if (hasCredentials) {
    const { load } = await import("https://deno.land/std@0.220.0/dotenv/mod.ts");
    await load({ envPath: ".env", examplePath: null, export: true });
  }

  // Suppress noisy server logs (only if not explicitly set in env or .env)
  // Note: PROXY_MODE is auto-detected by veryfront.config.ts based on OAuth credentials
  if (!Deno.env.get("LOG_LEVEL")) {
    Deno.env.set("LOG_LEVEL", "warn");
  }

  const { createApp, showStartup } = await import("../src/cli/app/index.ts");

  // Check ports BEFORE starting TUI to show clear error message
  await checkPorts(args.port);

  await clearModuleCaches();

  const localProjects = await discoverLocalProjects(args.projectPath);

  // Create app early so we can intercept console before server starts
  const app = createApp({
    port: args.port,
    projects: localProjects.projects,
    examples: localProjects.examples,
    defaultProject: localProjects.default ?? undefined,
    mcpPort: args.mcpPort,
    headless: args.headless,
  });

  // Intercept console BEFORE creating server (must be early to catch all logs)
  const restoreConsole = app.interceptConsole();

  // Show startup animation (skip in headless mode)
  if (!args.headless) {
    await showStartup([
      "Loading configuration",
      "Discovering projects",
      "Starting server",
    ]);
  }

  // Import dependencies
  const { createProxyHandler, injectContextHeaders } = await import("../proxy/handler.ts");
  const { createCacheFromEnv } = await import("../proxy/cache/index.ts");
  const { createDevServer } = await import("../src/server/dev-server.ts");

  // Create proxy handler - combine projects and examples for routing
  const allProjects = new Map([...localProjects.projects, ...localProjects.examples]);
  const proxyConfig = {
    apiBaseUrl: Deno.env.get("VERYFRONT_API_BASE_URL") || "http://api.lvh.me:4000",
    clientId: Deno.env.get("OAUTH_CLIENT_ID") || "",
    clientSecret: Deno.env.get("OAUTH_CLIENT_SECRET") || "",
    previewClientId: Deno.env.get("OAUTH_PREVIEW_CLIENT_ID") || "",
    previewClientSecret: Deno.env.get("OAUTH_PREVIEW_CLIENT_SECRET") || "",
    apiToken: Deno.env.get("VERYFRONT_API_TOKEN") || "",
    localProjects: Object.fromEntries(allProjects),
  };

  const cache = createCacheFromEnv();
  const proxyHandler = createProxyHandler({ config: proxyConfig, cache });

  // Request interceptor applies proxy logic to each request
  const requestInterceptor = async (req: Request): Promise<Request> => {
    const ctx = await proxyHandler.processRequest(req);
    return injectContextHeaders(req, ctx);
  };

  // Start server (port availability already checked above)
  const shutdownController = new AbortController();
  const devServer = await createDevServer({
    port: args.port,
    projectDir: Deno.cwd(),
    hmrPort: args.port + 1,
    enableHMR: true,
    enableFastRefresh: true,
    signal: shutdownController.signal,
    requestInterceptor,
  });
  await devServer.ready;

  // Start MCP server
  const { createMCPServer } = await import("../src/cli/mcp/index.ts");
  const mcpServer = await createMCPServer({
    httpPort: args.mcpPort,
  });

  // Mark server as ready
  app.setServerReady();

  // Graceful shutdown handler
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Restore console before shutdown messages
    restoreConsole();

    const inFlightCount = requestTracker.getInFlightCount();
    console.log(`\nShutting down... (${inFlightCount} in-flight requests)`);

    // Wait for in-flight requests to drain (5 seconds for dev server)
    if (inFlightCount > 0) {
      console.log("Waiting for requests to complete...");
      await requestTracker.waitForDrain(5000);
    }

    app.stop();
    await mcpServer.stop();
    requestTracker.shutdown();
    shutdownController.abort();
    await devServer.stop();
    await proxyHandler.close();
  };

  Deno.addSignalListener("SIGINT", () => {
    void shutdown().then(() => Deno.exit(0));
  });
  Deno.addSignalListener("SIGTERM", () => {
    void shutdown().then(() => Deno.exit(0));
  });

  // Start the app
  app.start();
}

main();
