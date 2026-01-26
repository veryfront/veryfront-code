import { cwd, getEnv } from "../../platform/compat/process.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { isAbsolute, join, resolve } from "../../platform/compat/path/index.js";
import { cliLogger } from "../../utils/index.js";
import { exitProcess, registerTerminationSignals } from "../utils/index.js";
const DEFAULT_START_PORT = 8080;
const DEFAULT_MCP_PORT = 9999;
function getProjectSlug(path) {
    return path.replace(/\/+$/, "").split("/").pop() || "";
}
async function isVeryFrontProject(projectPath) {
    const fs = createFileSystem();
    const markers = ["app", "pages", "components"];
    const checks = await Promise.all(markers.map((m) => fs.exists(join(projectPath, m))));
    return checks.some(Boolean);
}
async function findProjectsInDirs(baseDirs) {
    const projects = new Map();
    const fs = createFileSystem();
    for (const baseDir of baseDirs) {
        const absoluteBase = isAbsolute(baseDir) ? baseDir : join(cwd(), baseDir);
        if (!(await fs.exists(absoluteBase)))
            continue;
        try {
            for await (const entry of fs.readDir(absoluteBase)) {
                if (!entry.isDirectory || entry.name.startsWith("."))
                    continue;
                const projectPath = join(absoluteBase, entry.name);
                if (await isVeryFrontProject(projectPath)) {
                    projects.set(entry.name, resolve(projectPath));
                }
            }
        }
        catch {
            // Directory not readable - skip
        }
    }
    return projects;
}
async function discoverProjects(explicitPath) {
    const [projects, examples] = await Promise.all([
        findProjectsInDirs(["data/projects", "projects"]),
        findProjectsInDirs(["examples"]),
    ]);
    const fs = createFileSystem();
    let defaultProject = null;
    // Add explicit project path if provided
    if (explicitPath) {
        const absolutePath = isAbsolute(explicitPath) ? explicitPath : join(cwd(), explicitPath);
        if (await fs.exists(absolutePath)) {
            const slug = getProjectSlug(absolutePath);
            projects.set(slug, resolve(absolutePath));
            defaultProject = slug;
        }
    }
    // Fall back to current directory if no projects found
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
async function trySetupProxy(localProjects) {
    try {
        // Proxy is only available in local dev, not in the npm package
        const { createProxyHandler, injectContextHeaders } = await import("../../../proxy/handler.js");
        const { createCacheFromEnv } = await import("../../../proxy/cache/index.js");
        const proxyConfig = {
            apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") || "http://api.lvh.me:4000",
            clientId: getEnv("OAUTH_CLIENT_ID") || "",
            clientSecret: getEnv("OAUTH_CLIENT_SECRET") || "",
            previewClientId: getEnv("OAUTH_PREVIEW_CLIENT_ID") || "",
            previewClientSecret: getEnv("OAUTH_PREVIEW_CLIENT_SECRET") || "",
            apiToken: getEnv("VERYFRONT_API_TOKEN") || "",
            localProjects: Object.fromEntries(localProjects),
        };
        const cache = await createCacheFromEnv();
        const handler = createProxyHandler({ config: proxyConfig, cache });
        return {
            interceptor: async (req) => injectContextHeaders(req, await handler.processRequest(req)),
            close: () => handler.close(),
        };
    }
    catch {
        return { interceptor: undefined, close: async () => { } };
    }
}
export async function handleStartCommand(args) {
    const port = typeof args.port === "number" ? args.port : DEFAULT_START_PORT;
    const mcpPort = typeof args["mcp-port"] === "number" ? args["mcp-port"] : DEFAULT_MCP_PORT;
    const projectPath = args.project ? String(args.project) : null;
    const headless = Boolean(args.headless || args["no-tui"]);
    const { createApp, showStartup } = await import("../app/index.js");
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
    const { createDevServer } = await import("../../server/dev-server.js");
    const shutdownController = new AbortController();
    const devServer = await createDevServer({
        port,
        projectDir: cwd(),
        hmrPort: port + 1,
        enableHMR: true,
        enableFastRefresh: true,
        signal: shutdownController.signal,
        requestInterceptor: proxy.interceptor,
    });
    await devServer.ready;
    const { createMCPServer } = await import("../mcp/index.js");
    const mcpServer = await createMCPServer({ httpPort: mcpPort });
    app.setServerReady();
    let shuttingDown = false;
    async function shutdown() {
        if (shuttingDown)
            return;
        shuttingDown = true;
        restoreConsole();
        cliLogger.info("Shutting down...");
        app.stop();
        await mcpServer.stop();
        shutdownController.abort();
        await devServer.stop();
        await proxy.close();
        exitProcess(0);
    }
    registerTerminationSignals(() => void shutdown());
    app.start();
    await new Promise(() => { });
}
