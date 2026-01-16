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
import { banner } from "../src/cli/ui/components/banner.ts";
import { brand, dim } from "../src/cli/ui/colors.ts";
import { createKeyboardHandler } from "../src/cli/ui/keyboard.ts";
import { openBrowser } from "../src/cli/auth/browser.ts";

// Types
interface Args {
  port: number;
  projectPath: string | null;
}

interface LocalProjects {
  map: Map<string, string>;
  default: string | null;
}

// Parse CLI arguments
function parseArgs(): Args {
  const args = Deno.args;
  let port = 8080;
  let projectPath: string | null = null;

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
  }

  return { port, projectPath };
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
        const hasPages = await directoryExists(join(projectPath, "pages"));
        const hasComponents = await directoryExists(join(projectPath, "components"));
        if (hasPages || hasComponents) {
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

// Discover local projects
async function discoverLocalProjects(projectPath: string | null): Promise<LocalProjects> {
  const localProjectDirs = ["data/projects", "projects", "examples"];
  const map = await findLocalProjects(localProjectDirs);
  let defaultProject: string | null = null;

  if (projectPath && await directoryExists(projectPath)) {
    const slug = getProjectSlug(projectPath);
    // Convert to absolute path for consistent path resolution
    map.set(slug, resolve(projectPath));
    defaultProject = slug;
  }

  return { map, default: defaultProject };
}

// Print startup banner
function printBanner(port: number, localProjects: LocalProjects, hasCredentials: boolean): void {
  const serverUrl = `http://lvh.me:${port}`;

  console.log();
  console.log(banner({
    title: "Veryfront",
    subtitle: "is now running",
    info: {
      url: serverUrl,
      ...(localProjects.default && { project: localProjects.default }),
    },
  }));

  if (localProjects.map.size > 0) {
    console.log();
    console.log(`  ${dim("Local projects:")}`);
    let i = 1;
    for (const [slug, path] of localProjects.map) {
      const num = i <= 9 ? brand(String(i)) : " ";
      console.log(`    ${num} ${slug} ${dim(path)}`);
      i++;
    }
  }

  if (hasCredentials) {
    console.log();
    console.log(`  ${dim("API access enabled")}`);
  }

  console.log();
  console.log(`  ${dim("Press")} ${brand("1-9")} ${dim("to open project,")} ${brand("q")} ${dim("to quit")}`);
  console.log();
}

// Main
async function main(): Promise<void> {
  const args = parseArgs();
  await clearModuleCaches();

  // Suppress noisy server logs (we print our own banner)
  Deno.env.set("LOG_LEVEL", "warn");

  const localProjects = await discoverLocalProjects(args.projectPath);
  const hasCredentials = await hasEnvFile();

  // Import dependencies (after setting LOG_LEVEL)
  const { createProxyHandler, injectContextHeaders } = await import("../proxy/handler.ts");
  const { createCacheFromEnv } = await import("../proxy/cache/index.ts");
  const { createDevServer } = await import("../src/server/dev-server.ts");

  // Load .env if available
  if (hasCredentials) {
    const { load } = await import("https://deno.land/std@0.220.0/dotenv/mod.ts");
    await load({ envPath: ".env", examplePath: null, export: true });
  }

  // Create proxy handler
  const proxyConfig = {
    apiBaseUrl: Deno.env.get("VERYFRONT_API_BASE_URL") || "http://api.lvh.me:4000",
    clientId: Deno.env.get("OAUTH_CLIENT_ID") || "",
    clientSecret: Deno.env.get("OAUTH_CLIENT_SECRET") || "",
    previewClientId: Deno.env.get("OAUTH_PREVIEW_CLIENT_ID") || "",
    previewClientSecret: Deno.env.get("OAUTH_PREVIEW_CLIENT_SECRET") || "",
    localProjects: Object.fromEntries(localProjects.map),
  };

  const cache = createCacheFromEnv();
  const proxyHandler = createProxyHandler({ config: proxyConfig, cache });

  const missing = proxyHandler.validateConfig();
  if (missing.length > 0) {
    console.log(dim(`  Missing OAuth credentials: ${missing.join(", ")}`));
  }

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
  printBanner(args.port, localProjects, hasCredentials);

  // Shutdown handler
  const shutdown = async () => {
    keyboardHandler.stop();
    console.log();
    console.log(dim("  Shutting down..."));
    shutdownController.abort();
    await devServer.stop();
    await proxyHandler.close();
    Deno.exit(0);
  };

  // Keyboard shortcuts
  const projectSlugs = Array.from(localProjects.map.keys());
  const keyboardHandler = createKeyboardHandler({
    onNumber: (n) => {
      const slug = projectSlugs[n - 1];
      if (slug) {
        void openBrowser(`http://${slug}.lvh.me:${args.port}`);
      }
    },
    onClear: () => console.clear(),
    onQuit: () => void shutdown(),
  });
  keyboardHandler.start();

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());
}

main();
