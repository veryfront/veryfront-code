import { cwd, getEnv, onGlobalError, setEnv } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isAbsolute, join, resolve } from "#veryfront/compat/path/index.ts";
import { cliLogger } from "#veryfront/utils";
import { exitProcess, registerTerminationSignals } from "#cli/utils";
import { generateDefaultProjectId } from "../../utils/project.ts";
import { clearAllLocalCaches } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import type { DiscoveryOptions } from "#veryfront/server/production-server.ts";

export interface StartOptions {
  port: number;
  mcpPort: number;
  projectPath: string | null;
  headless: boolean;
}

interface DiscoveredProjects {
  projects: Map<string, string>;
  examples: Map<string, string>;
  defaultProject: string | null;
}

interface ProxySetup {
  interceptor: ((req: Request) => Promise<Request>) | undefined;
  close: () => Promise<void>;
}

function getProjectSlug(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
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

async function trySetupProxy(localProjects: Map<string, string>): Promise<ProxySetup> {
  try {
    // Proxy is only available in local dev, not in the npm package
    const { createProxyHandler, injectContextHeaders } = await import(
      "#veryfront/proxy/handler.ts"
    );
    const { createCacheFromEnv } = await import("#veryfront/proxy/cache/index.ts");

    const proxyConfig = {
      apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") ?? "http://api.veryfront.me:4000",
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

export async function startCommand(options: StartOptions): Promise<void> {
  const { port, mcpPort, projectPath, headless } = options;

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

  await clearAllLocalCaches();

  const { createApp, showStartup } = await import("../../app/index.ts");
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
    const baseAdapter = await runtime.get();

    const bootstrap = await bootstrapProd(cwd(), baseAdapter);
    const adapter = bootstrap.adapter;

    const defaultProjectId = generateDefaultProjectId(cwd());

    // Build discovery config based on adapter mode
    // The production server handles execution; CLI provides configuration
    let discoveryConfig: DiscoveryOptions | undefined;
    if (bootstrap.usingFSAdapter) {
      const token = getEnv("VERYFRONT_API_TOKEN") ?? "";
      const slug = getEnv("VERYFRONT_PROJECT_SLUG") ?? discovered.defaultProject ?? "";
      discoveryConfig = {
        baseDir: "",
        fsAdapter: adapter.fs,
        projectSlug: slug || undefined,
        apiToken: token || undefined,
        verbose: false,
      };
    } else {
      discoveryConfig = { baseDir: projectDir, verbose: false };
    }

    server = await startUniversalServer({
      port,
      projectDir: cwd(),
      mode: "development",
      adapter,
      bootstrapResult: bootstrap,
      signal: shutdownController.signal,
      requestInterceptor: proxy.interceptor,
      defaultProjectSlug: defaultProjectId,
      defaultProjectId,
      discoveryConfig,
    });
  } else {
    const { createDevServer } = await import("#veryfront/server/dev-server.ts");
    // Dev server handles AI discovery internally (Phase 2)
    server = await createDevServer({
      port,
      projectDir: cwd(),
      hmrPort: port + 1,
      enableHMR: true,
      enableFastRefresh: true,
      signal: shutdownController.signal,
    });
  }

  await server.ready;

  const { createMCPServer } = await import("../../mcp/index.ts");
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
