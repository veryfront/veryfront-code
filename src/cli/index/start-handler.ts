/**
 * Start Handler - Full TUI dashboard with project discovery
 *
 * Default command when running `veryfront` without arguments.
 * Provides a TUI experience with project navigation and dev server.
 */

import { cwd, getEnv, onGlobalError, setEnv } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isAbsolute, join, resolve } from "#veryfront/platform/compat/path/index.ts";
import { cliLogger } from "#veryfront/utils";
import { exitProcess, registerTerminationSignals } from "../utils/index.ts";
import { clearAllLocalCaches } from "../../transforms/mdx/esm-module-loader/cache/index.ts";
import { discoverAll } from "../discovery/index.ts";
import type { ParsedArgs } from "./types.ts";

const DEFAULT_START_PORT = 8080;
const DEFAULT_MCP_PORT = 9999;

interface DiscoveredProjects {
  projects: Map<string, string>;
  examples: Map<string, string>;
  defaultProject: string | null;
}

function getProjectSlug(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * Generate a default project ID from the project directory name.
 * Used for local filesystem mode when no project ID is available from API.
 */
function generateDefaultProjectId(projectDir: string): string {
  const slug = getProjectSlug(projectDir);
  // Clean the directory name to create a valid project ID
  return `local-${slug.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}`;
}

async function isVeryFrontProject(projectPath: string): Promise<boolean> {
  const fs = createFileSystem();
  const markers = ["app", "pages", "components"];
  const checks = await Promise.all(markers.map((m) => fs.exists(join(projectPath, m))));
  return checks.some(Boolean);
}

async function findProjectsInDirs(baseDirs: string[]): Promise<Map<string, string>> {
  const projects = new Map<string, string>();
  const fs = createFileSystem();

  for (const baseDir of baseDirs) {
    const absoluteBase = isAbsolute(baseDir) ? baseDir : join(cwd(), baseDir);
    if (!(await fs.exists(absoluteBase))) continue;

    try {
      for await (const entry of fs.readDir(absoluteBase)) {
        if (!entry.isDirectory || entry.name.startsWith(".")) continue;

        const projectPath = join(absoluteBase, entry.name);
        if (!(await isVeryFrontProject(projectPath))) continue;

        projects.set(entry.name, resolve(projectPath));
      }
    } catch {
      // Directory not readable - skip
    }
  }

  return projects;
}

async function discoverProjects(explicitPath: string | null): Promise<DiscoveredProjects> {
  const [projects, examples] = await Promise.all([
    findProjectsInDirs(["data/projects", "projects"]),
    findProjectsInDirs(["examples"]),
  ]);

  const fs = createFileSystem();
  let defaultProject: string | null = null;

  if (explicitPath) {
    const absolutePath = isAbsolute(explicitPath) ? explicitPath : join(cwd(), explicitPath);
    if (await fs.exists(absolutePath)) {
      const slug = getProjectSlug(absolutePath);
      projects.set(slug, resolve(absolutePath));
      defaultProject = slug;
    }
  }

  if (projects.size === 0 && !defaultProject) {
    const currentDir = cwd();
    if (await isVeryFrontProject(currentDir)) {
      const slug = getProjectSlug(currentDir);
      projects.set(slug, resolve(currentDir));
      defaultProject = slug;
    }
  }

  return { projects, examples, defaultProject };
}

interface ProxySetup {
  interceptor: ((req: Request) => Promise<Request>) | undefined;
  close: () => Promise<void>;
}

async function trySetupProxy(localProjects: Map<string, string>): Promise<ProxySetup> {
  try {
    // Proxy is only available in local dev, not in the npm package
    const { createProxyHandler, injectContextHeaders } = await import("../../proxy/handler.ts");
    const { createCacheFromEnv } = await import("../../proxy/cache/index.ts");

    const proxyConfig = {
      apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") ?? "http://api.lvh.me:4000",
      clientId: getEnv("API_CLIENT_ID") ?? "",
      clientSecret: getEnv("API_CLIENT_SECRET") ?? "",
      previewClientId: getEnv("API_CLIENT_ID") ?? "",
      previewClientSecret: getEnv("API_CLIENT_SECRET") ?? "",
      apiToken: getEnv("VERYFRONT_API_TOKEN") ?? "",
      localProjects: Object.fromEntries(localProjects),
    };

    const cache = await createCacheFromEnv();
    const handler = createProxyHandler({ config: proxyConfig, cache });

    return {
      interceptor: async (req: Request) =>
        injectContextHeaders(req, await handler.processRequest(req)),
      close: () => handler.close(),
    };
  } catch {
    return { interceptor: undefined, close: async () => {} };
  }
}

export async function handleStartCommand(args: ParsedArgs): Promise<void> {
  // Register global error handlers FIRST to prevent process crashes from application errors
  onGlobalError((error, type) => {
    const isFatal = (error.name === "RangeError" && error.message.includes("Maximum call stack")) ||
      error.message.includes("out of memory") ||
      error.message.includes("allocation failed");

    cliLogger.error(`[GLOBAL] ${type}: Application error caught`, {
      message: error.message,
      stack: error.stack,
      type,
      fatal: isFatal,
    });

    if (isFatal) {
      cliLogger.error("[GLOBAL] Fatal error detected, allowing process exit");
      return false;
    }
    return true;
  });

  const hasExplicitPort = args.__explicit?.port === true;
  const port = hasExplicitPort && typeof args.port === "number" ? args.port : DEFAULT_START_PORT;
  const mcpPort = typeof args["mcp-port"] === "number" ? args["mcp-port"] : DEFAULT_MCP_PORT;
  const projectPath = args.project ? String(args.project) : null;
  const headless = Boolean(args.headless || args["no-tui"]);

  // Clear stale ESM caches to prevent module resolution issues
  await clearAllLocalCaches();

  const { createApp, showStartup } = await import("../app/index.ts");
  const discovered = await discoverProjects(projectPath);

  const app = createApp({
    port,
    mcpPort,
    headless,
    projects: discovered.projects,
    examples: discovered.examples,
    defaultProject: discovered.defaultProject ?? undefined,
  });

  const restoreConsole = app.interceptConsole();

  if (!headless) {
    await showStartup(["Loading configuration", "Discovering projects", "Starting server"]);
  }

  const allProjects = new Map([...discovered.projects, ...discovered.examples]);
  const proxy = await trySetupProxy(allProjects);
  const shutdownController = new AbortController();
  const useProxy = typeof proxy.interceptor === "function";

  let server: { ready: Promise<void>; stop: () => Promise<void> };

  // Determine project directory for discovery
  const projectDir = discovered.defaultProject
    ? discovered.projects.get(discovered.defaultProject) ?? cwd()
    : cwd();

  if (useProxy) {
    // Enable proxy mode so the FSAdapter fetches files from the API
    // This must be set before importing production-server which loads config
    // NODE_ENV=development allows dev features while proxy mode fetches from API
    setEnv("PROXY_MODE", "1");
    setEnv("NODE_ENV", "development");

    const { startUniversalServer } = await import("#veryfront/server/production-server.ts");
    const { bootstrapProd } = await import("#veryfront/server/bootstrap.ts");
    const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
    const { isExtendedFSAdapter } = await import("#veryfront/platform/adapters/fs/wrapper.ts");
    const baseAdapter = await runtime.get();

    // Bootstrap to get the enhanced adapter with API-backed FS
    const bootstrap = await bootstrapProd(cwd(), baseAdapter);
    const adapter = bootstrap.adapter;

    // Generate default project ID for local filesystem mode
    const defaultProjectId = generateDefaultProjectId(cwd());

    server = await startUniversalServer({
      port,
      projectDir: cwd(),
      mode: "development",
      adapter,
      bootstrapResult: bootstrap, // Pass bootstrap result to skip internal bootstrap
      signal: shutdownController.signal,
      requestInterceptor: proxy.interceptor,
      defaultProjectSlug: defaultProjectId,
      defaultProjectId,
    });

    // Run AI discovery with API-backed fsAdapter for multi-project mode
    // Must wrap in runWithContext to set project context for API calls
    try {
      if (isExtendedFSAdapter(adapter.fs) && adapter.fs.isMultiProjectMode()) {
        const token = getEnv("VERYFRONT_API_TOKEN") ?? "";
        // Prefer VERYFRONT_PROJECT_SLUG env var over discovered project to ensure
        // remote slug matches (local folder names may differ from API slugs)
        const slug = getEnv("VERYFRONT_PROJECT_SLUG") ?? discovered.defaultProject ?? "";
        if (slug && token) {
          await adapter.fs.runWithContext(slug, token, async () => {
            // Use "" as baseDir since API adapter works with relative paths
            // Note: "." would create paths like "./tools" which PathNormalizer doesn't handle
            await discoverAll({ baseDir: "", fsAdapter: adapter.fs, verbose: false });
          });
        } else {
          cliLogger.debug("AI discovery skipped: no project slug or token for proxy mode");
        }
      } else if (bootstrap.usingFSAdapter) {
        // Non-multi-project API adapter (single project mode)
        await discoverAll({ baseDir: "", fsAdapter: adapter.fs, verbose: false });
      } else {
        // Local filesystem fallback
        await discoverAll({ baseDir: projectDir, verbose: false });
      }
    } catch (error) {
      cliLogger.debug("AI discovery error (proxy mode):", error);
    }
  } else {
    const { createDevServer } = await import("#veryfront/server/dev-server.ts");
    server = await createDevServer({
      port,
      projectDir: cwd(),
      hmrPort: port + 1,
      enableHMR: true,
      enableFastRefresh: true,
      signal: shutdownController.signal,
    });

    // Run AI discovery with local filesystem
    try {
      await discoverAll({ baseDir: projectDir, verbose: false });
    } catch (error) {
      cliLogger.debug("AI discovery error:", error);
    }
  }

  await server.ready;

  const { createMCPServer } = await import("../mcp/index.ts");
  const mcpServer = await createMCPServer({ httpPort: mcpPort });

  app.setServerReady();

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    restoreConsole();
    cliLogger.info("Shutting down...");

    app.stop();
    await mcpServer.stop();
    shutdownController.abort();
    await server.stop();
    await proxy.close();
    exitProcess(0);
  }

  registerTerminationSignals(() => void shutdown());
  app.start();

  await new Promise(() => {});
}
