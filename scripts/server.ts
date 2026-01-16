#!/usr/bin/env -S deno run --allow-all
/**
 * Veryfront Server
 *
 * Starts proxy + renderer in a single process.
 *
 * Usage:
 *   deno task start                     # Start server
 *   deno task start --project <path>    # Set default project
 *   deno task start -p 8080             # Custom port
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

import { join, resolve } from "https://deno.land/std@0.220.0/path/mod.ts";

// Types
interface Args {
  port: number;
  projectPath: string | null;
  mcpPort: number;
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
  }

  return { port, projectPath, mcpPort };
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
  const { createApp, showStartup } = await import("../src/cli/app/index.ts");

  await clearModuleCaches();

  // Suppress noisy server logs
  Deno.env.set("LOG_LEVEL", "warn");

  // Show startup animation
  await showStartup([
    "Loading configuration",
    "Discovering projects",
    "Starting server",
  ]);

  const localProjects = await discoverLocalProjects(args.projectPath);
  const hasCredentials = await hasEnvFile();

  // Import dependencies
  const { createProxyHandler, injectContextHeaders } = await import("../proxy/handler.ts");
  const { createCacheFromEnv } = await import("../proxy/cache/index.ts");
  const { createDevServer } = await import("../src/server/dev-server.ts");

  // Load .env if available
  if (hasCredentials) {
    const { load } = await import("https://deno.land/std@0.220.0/dotenv/mod.ts");
    await load({ envPath: ".env", examplePath: null, export: true });
  }

  // Create proxy handler - combine projects and examples for routing
  const allProjects = new Map([...localProjects.projects, ...localProjects.examples]);
  const proxyConfig = {
    apiBaseUrl: Deno.env.get("VERYFRONT_API_BASE_URL") || "http://api.lvh.me:4000",
    clientId: Deno.env.get("OAUTH_CLIENT_ID") || "",
    clientSecret: Deno.env.get("OAUTH_CLIENT_SECRET") || "",
    previewClientId: Deno.env.get("OAUTH_PREVIEW_CLIENT_ID") || "",
    previewClientSecret: Deno.env.get("OAUTH_PREVIEW_CLIENT_SECRET") || "",
    localProjects: Object.fromEntries(allProjects),
  };

  const cache = createCacheFromEnv();
  const proxyHandler = createProxyHandler({ config: proxyConfig, cache });

  // Request interceptor applies proxy logic to each request
  const requestInterceptor = async (req: Request): Promise<Request> => {
    const ctx = await proxyHandler.processRequest(req);
    return injectContextHeaders(req, ctx);
  };

  // Start server
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

  // Create and start the app
  const app = createApp({
    port: args.port,
    projects: localProjects.projects,
    examples: localProjects.examples,
    defaultProject: localProjects.default ?? undefined,
    mcpPort: args.mcpPort,
  });

  // Mark server as ready
  app.setServerReady();

  // Shutdown handler
  const shutdown = async () => {
    app.stop();
    await mcpServer.stop();
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
