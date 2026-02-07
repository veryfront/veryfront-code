import { cwd, getEnv, onGlobalError } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import { isAbsolute, join, resolve } from "veryfront/platform/path";
import { cliLogger } from "#cli/utils";
import { exitProcess, registerTerminationSignals } from "#cli/utils";
import { generateDefaultProjectId } from "../../utils/project.ts";
import { clearAllLocalCaches } from "veryfront/transforms/mdx-cache";
import { startCliDevServer, startCliProxyModeServer } from "#cli/shared/server-startup";

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
      "veryfront/proxy/handler"
    );
    const { createCacheFromEnv } = await import("veryfront/proxy/cache");

    const proxyConfig = {
      apiBaseUrl: getEnv("VERYFRONT_PROXY_API_BASE_URL") ?? "https://api.veryfront.com",
      apiClientId: getEnv("VERYFRONT_PROXY_API_CLIENT_ID") ?? "",
      apiClientSecret: getEnv("VERYFRONT_PROXY_API_CLIENT_SECRET") ?? "",
      previewApiClientId: getEnv("VERYFRONT_PROXY_API_CLIENT_ID") ?? "",
      previewApiClientSecret: getEnv("VERYFRONT_PROXY_API_CLIENT_SECRET") ?? "",
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
    const defaultProjectId = generateDefaultProjectId(cwd());
    const requestInterceptor = proxy.interceptor;
    if (!requestInterceptor) {
      throw new Error("Proxy interceptor missing in proxy mode");
    }
    server = await startCliProxyModeServer({
      port,
      projectDir,
      signal: shutdownController.signal,
      requestInterceptor,
      defaultProjectSlug: defaultProjectId,
      defaultProjectId,
      fallbackProjectSlug: discovered.defaultProject ?? undefined,
    });
  } else {
    server = await startCliDevServer({
      port,
      projectDir,
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
