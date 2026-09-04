import { onGlobalError } from "#cli/process-lifecycle";
import { cwd, getEnv } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import { isAbsolute, join, resolve } from "veryfront/platform/path";
import { cliLogger } from "#cli/utils";
import { exitProcess, registerTerminationSignals } from "#cli/utils";
import { generateDefaultProjectId } from "../../utils/project.ts";
import { clearAllLocalCaches } from "veryfront/transforms/mdx-cache";
import { startCliDevServer, startCliProxyModeServer } from "#cli/shared/server-startup";
import { applyQualifiedRuntimeAuth, resolveLinkedProjectSlug } from "#cli/shared/runtime-auth";

const logger = cliLogger.component("global");

export interface StartOptions {
  port: number;
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

export interface StartProjectSelection {
  projectDir: string;
  projectSlug: string | undefined;
}

export function createGlobalErrorLogContext(
  error: Error,
  type: string,
  fatal: boolean,
): { message: string; type: string; fatal: boolean; stack?: string } {
  return {
    message: error.message,
    type,
    fatal,
  };
}

function getProjectSlug(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

export function shouldSkipProjectDirectory(name: string): boolean {
  return name.startsWith(".") || name.startsWith("_");
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
        if (!entry.isDirectory || shouldSkipProjectDirectory(entry.name)) continue;

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
  const [projects] = await Promise.all([
    findProjectsInDirs(["data/projects", "projects"]),
  ]);
  const examples = new Map<string, string>();

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

function firstBySlug(map: Map<string, string>): [string, string] | undefined {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
}

export function selectStartProject(
  discovered: DiscoveredProjects,
  fallbackDir: string,
): StartProjectSelection {
  if (discovered.defaultProject) {
    const projectDir = discovered.projects.get(discovered.defaultProject) ??
      discovered.examples.get(discovered.defaultProject);
    if (projectDir) {
      return { projectDir, projectSlug: discovered.defaultProject };
    }
  }

  const fallbackProject = firstBySlug(discovered.projects) ?? firstBySlug(discovered.examples);
  if (fallbackProject) {
    const [projectSlug, projectDir] = fallbackProject;
    return { projectDir, projectSlug };
  }

  return { projectDir: fallbackDir, projectSlug: undefined };
}

export async function hydrateStartRuntimeAuth(
  selectedProject: StartProjectSelection,
): Promise<string | undefined> {
  const linkedProjectSlug = await resolveLinkedProjectSlug(selectedProject.projectDir);
  await applyQualifiedRuntimeAuth(selectedProject.projectDir, linkedProjectSlug);
  return linkedProjectSlug;
}

/**
 * The proxy resolves each request to a project through the Veryfront API using
 * its own client credentials. Unconfigured it still loads, forces
 * `PROXY_MODE=1`, and then rejects every request for a missing `x-token`, so
 * treat "no credentials" as "no proxy" and let the local dev server serve the
 * project instead.
 *
 * A plain login token is deliberately not enough. `applyRuntimeAuthContext`
 * puts the stored CLI login token in `VERYFRONT_API_TOKEN` before this runs, so
 * accepting it would mean that merely being logged in pushes `veryfront start`
 * into a proxy mode it cannot actually serve from.
 */
export function hasProxyCredentials(
  read: (name: string) => string | undefined = getEnv,
): boolean {
  const clientId = read("VERYFRONT_PROXY_API_CLIENT_ID")?.trim();
  const clientSecret = read("VERYFRONT_PROXY_API_CLIENT_SECRET")?.trim();

  return Boolean(clientId && clientSecret);
}

async function trySetupProxy(localProjects: Map<string, string>): Promise<ProxySetup> {
  if (!hasProxyCredentials()) {
    return { interceptor: undefined, close: () => Promise.resolve() };
  }

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
  const { port, projectPath, headless } = options;

  onGlobalError((error, type) => {
    const isFatal = (error.name === "RangeError" && error.message.includes("Maximum call stack")) ||
      error.message.includes("out of memory") ||
      error.message.includes("allocation failed");

    logger.error(
      `${type}: Application error caught`,
      createGlobalErrorLogContext(error, type, isFatal),
    );

    if (isFatal) {
      logger.error("Fatal error detected, allowing process exit");
      return false;
    }
    return true;
  });

  const { createApp, startStartupProgress } = await import("../../app/index.ts");

  // Each step advances when its work finishes, so startup costs what the work
  // costs rather than a fixed animation length.
  const progress = headless ? null : startStartupProgress([
    "Loading configuration",
    "Discovering projects",
    "Starting server",
  ]);

  // Populated as startup progresses so a failure can unwind whatever opened.
  let openServer: { stop: () => Promise<void> } | undefined;
  let openProxy: ProxySetup | undefined;
  let openController: AbortController | undefined;

  const releaseStartupResources = async (): Promise<void> => {
    try {
      openController?.abort();
      await openServer?.stop();
      await openProxy?.close();
    } catch (cleanupError) {
      cliLogger.warn("Error while cleaning up a failed start:", cleanupError);
    }
  };

  // Any failure between here and a ready server must stop the ticker and
  // leave the checklist honest; otherwise the interval keeps the process
  // alive and the terminal stays in the alternate screen.
  try {
    progress?.begin(0);
    await clearAllLocalCaches();

    progress?.begin(1);
    const discovered = await discoverProjects(projectPath);

    // Log discovered projects for discoverability
    const totalProjects = discovered.projects.size + discovered.examples.size;
    if (discovered.defaultProject) {
      logger.info(`Serving project "${discovered.defaultProject}"`);
    } else if (totalProjects > 0) {
      const dirs = [
        ...new Set(
          [...discovered.projects.values(), ...discovered.examples.values()]
            .map((p) => {
              const rel = p.replace(cwd() + "/", "");
              return rel.split("/").slice(0, -1).join("/");
            }),
        ),
      ].join(", ");
      logger.info(`Found ${totalProjects} project(s) in ${dirs}`);
    } else {
      logger.info(
        "No projects found. Create one with `veryfront init my-app` or place projects in ./projects/",
      );
    }

    const app = createApp({
      port,
      headless,
      projects: discovered.projects,
    });

    const restoreConsole = app.interceptConsole();

    progress?.begin(2);

    const selectedProject = selectStartProject(discovered, cwd());
    const projectDir = selectedProject.projectDir;
    const linkedProjectSlug = await hydrateStartRuntimeAuth(selectedProject);

    const allProjects = new Map([...discovered.projects, ...discovered.examples]);
    const proxy = await trySetupProxy(allProjects);
    openProxy = proxy;
    const shutdownController = new AbortController();
    openController = shutdownController;
    const useProxy = typeof proxy.interceptor === "function";

    let server: { ready: Promise<void>; stop: () => Promise<void> };
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
        defaultProjectId,
        linkedProjectSlug,
      });
    } else {
      server = await startCliDevServer({
        port,
        projectDir,
        enableHMR: true,
        enableFastRefresh: true,
        signal: shutdownController.signal,
      });
    }

    openServer = server;

    await server.ready;
    progress?.finish();

    // Startup succeeded; shutdown() owns these from here.
    openServer = undefined;
    openProxy = undefined;
    openController = undefined;

    app.setServerReady();

    let shuttingDown = false;
    const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;

      restoreConsole();
      cliLogger.info(`Received ${signal}, shutting down...`);

      try {
        app.stop();
        shutdownController.abort();
        await server.stop();
        await proxy.close();
      } catch (error) {
        cliLogger.warn("Error while shutting down start command:", error);
      } finally {
        exitProcess(0);
      }
    };

    registerTerminationSignals((signal) => shutdown(signal));
    app.start();

    await new Promise(() => {});
  } catch (error) {
    progress?.stop();
    // A server that bound a port, or a proxy handler that opened, must not
    // outlive a failed startup: nothing else will close them before exit.
    await releaseStartupResources();
    throw error;
  }
}
