/****
 * Dev Command - Development server with HMR
 */
import * as dntShim from "../../../_dnt.shims.js";
import { compileAllMDX, watchMDX } from "../../build/compiler/mdx-compiler/index.js";
import { ErrorCode, VeryfrontError } from "../../errors/index.js";
import { join } from "../../platform/compat/path/index.js";
import { runtime } from "../../platform/adapters/detect.js";
import { getConfig } from "../../config/index.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { createDevServer } from "../../server/dev-server.js";
import { runAIConfigValidation } from "../discovery/config-validator.js";
import { discoverAll } from "../discovery/index.js";
import { exitProcess, registerTerminationSignals } from "../utils/index.js";
import { banner } from "../ui/components/banner.js";
import { brand, dim, error as errorColor, success } from "../ui/colors.js";
import { createKeyboardHandler } from "../ui/keyboard.js";
import { openBrowser } from "../auth/browser.js";
import { createMCPServer } from "../mcp/server.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { login, validateToken } from "../auth/login.js";
import { readToken } from "../auth/token-store.js";
import { fetchRemoteProjects } from "../sync/index.js";
import { pullCommand } from "./pull.js";
import { pushCommand } from "./push.js";
export function devCommand(options) {
    return withSpan("cli.command.dev", async () => {
        const { port, projectDir, hmr = true, demoMode = false } = options;
        let doneResolve;
        const done = new Promise((resolve) => {
            doneResolve = resolve;
        });
        const adapter = await runtime.get();
        let config;
        try {
            config = await getConfig(projectDir, adapter);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("not found")) {
                throw new VeryfrontError("No veryfront.config.js found", ErrorCode.CONFIG_ERROR, {
                    projectDir,
                });
            }
            throw error;
        }
        const DEFAULT_DEV_PORT = 3000;
        const finalPort = port !== DEFAULT_DEV_PORT ? port : (config?.dev?.port ?? port);
        const enableHMR = config?.dev?.hmr !== false && hmr;
        const env = getRuntimeEnv();
        const isProxyMode = config?.fs?.veryfront?.proxyMode === true;
        const projectSlug = config?.fs?.veryfront?.projectSlug ?? env.projectSlug;
        if (config)
            runAIConfigValidation(config);
        try {
            await discoverAll({ baseDir: projectDir, verbose: false });
        }
        catch {
            // AI discovery skipped
        }
        if (config?.experimental?.precompileMDX) {
            const outputDir = join(projectDir, ".veryfront", "compiled");
            try {
                await compileAllMDX({ projectDir, outputDir, mode: "development" });
                void watchMDX({ projectDir, outputDir, mode: "development" });
            }
            catch {
                // MDX pre-compilation failed
            }
        }
        const shutdownController = new AbortController();
        let devServer = null;
        let mcpServer = null;
        // Sync state
        let user = null;
        let projects = [];
        let selectedProject = null;
        try {
            devServer = await createDevServer({
                port: finalPort,
                projectDir,
                hmrPort: finalPort + 1,
                enableHMR,
                enableFastRefresh: true,
                signal: shutdownController.signal,
            });
        }
        catch (error) {
            if (error instanceof Error) {
                const msg = error.message.toLowerCase();
                if (msg.includes("eaddrinuse") || msg.includes("address already in use")) {
                    throw new VeryfrontError(`Port ${finalPort} is already in use`, ErrorCode.INITIALIZATION_ERROR, { port: finalPort });
                }
            }
            throw error;
        }
        const mcpPort = finalPort + 2;
        try {
            mcpServer = await createMCPServer({ httpPort: mcpPort });
        }
        catch {
            // MCP server failed to start - non-fatal, continue without it
        }
        // Check for existing auth
        try {
            const token = await readToken();
            if (token) {
                user = await validateToken(token);
                if (user) {
                    const result = await fetchRemoteProjects();
                    projects = result.projects;
                }
            }
        }
        catch {
            // Auth check failed - non-fatal
        }
        let keyboardHandler = null;
        let shuttingDown = false;
        async function runSyncAction(action, successMsg) {
            try {
                await action();
                console.log(`  ${success("✓")} ${successMsg}`);
            }
            catch (err) {
                console.log(`  ${errorColor("✗")} ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        async function shutdown() {
            if (shuttingDown) {
                if (!demoMode)
                    exitProcess(0);
                return;
            }
            shuttingDown = true;
            const timeout = demoMode ? null : dntShim.setTimeout(() => exitProcess(0), 3000);
            try {
                keyboardHandler?.stop();
                shutdownController.abort();
                await mcpServer?.stop();
                await devServer?.stop();
            }
            catch {
                // ignore
            }
            finally {
                if (timeout)
                    clearTimeout(timeout);
            }
            if (demoMode) {
                doneResolve?.();
                return;
            }
            exitProcess(0);
        }
        registerTerminationSignals(() => void shutdown());
        if (!isProxyMode) {
            const serverUrl = `http://veryfront.me:${finalPort}`;
            console.log();
            console.log(banner({
                title: "Veryfront",
                subtitle: "is now running",
                info: {
                    url: serverUrl,
                    ...(projectSlug ? { project: projectSlug } : {}),
                    ...(mcpServer ? { mcp: `http://veryfront.me:${mcpPort}/mcp` } : {}),
                },
            }));
            console.log();
            console.log(`  ${success("✓")} Server ready at ${brand(serverUrl)}`);
            if (mcpServer) {
                console.log(`  ${success("✓")} MCP ready at ${brand(`http://veryfront.me:${mcpPort}/mcp`)}`);
            }
            console.log();
            // Context-aware next step hint
            if (!user) {
                console.log(`  ${dim("To sync with Veryfront: press")} ${brand("a")} ${dim("to login")}`);
            }
            else if (projects.length > 0) {
                console.log(`  ${success("✓")} Logged in as ${user.email}`);
                console.log(`  ${dim("Press")} ${brand("s")} ${dim("to select a project, then")} ${brand("p")} ${dim("to pull")}`);
            }
            else {
                console.log(`  ${success("✓")} Logged in as ${user.email}`);
                console.log(`  ${dim("Press")} ${brand("s")} ${dim("to see your projects")}`);
            }
            console.log();
            if (!demoMode) {
                keyboardHandler = createKeyboardHandler({
                    onOpen: () => void openBrowser(serverUrl),
                    onClear: () => console.clear(),
                    onQuit: () => void shutdown(),
                    onAuth: async () => {
                        if (user) {
                            console.log(`  ${dim("Logged in as")} ${user.email} ${dim("— press s to select project")}`);
                            return;
                        }
                        console.log(`  ${dim("Opening browser...")}`);
                        const result = await login();
                        if (result) {
                            user = result;
                            const projectResult = await fetchRemoteProjects();
                            projects = projectResult.projects;
                            console.log(`  ${success("✓")} ${user.email} ${dim(`— ${projects.length} projects`)}`);
                        }
                    },
                    onSync: () => {
                        if (!user) {
                            console.log(`  ${dim("Press")} ${brand("a")} ${dim("to login")}`);
                            return;
                        }
                        if (projects.length === 0) {
                            console.log(`  ${dim("No projects")}`);
                            return;
                        }
                        projects.forEach((p, i) => {
                            const active = selectedProject?.id === p.id;
                            console.log(`  ${active ? success("●") : dim("○")} ${brand(String(i + 1))} ${p.name}`);
                        });
                    },
                    onNumber: async (n) => {
                        const project = projects[n - 1];
                        if (!project)
                            return;
                        selectedProject = project;
                        console.log(`  ${success("●")} ${project.name} ${dim("— pulling...")}`);
                        await runSyncAction(() => pullCommand({ projectSlug: project.slug, projectDir, force: true, quiet: true }), `Ready ${dim("— p pull / u push")}`);
                    },
                    onPull: async () => {
                        const project = selectedProject;
                        if (!project) {
                            console.log(`  ${dim("Press s to select project")}`);
                            return;
                        }
                        console.log(`  ${dim("Pulling...")}`);
                        await runSyncAction(() => pullCommand({ projectSlug: project.slug, projectDir, force: true, quiet: true }), "Pulled");
                    },
                    onPush: async () => {
                        if (!selectedProject) {
                            console.log(`  ${dim("Press s to select project")}`);
                            return;
                        }
                        console.log(`  ${dim("Pushing...")}`);
                        await runSyncAction(() => pushCommand({ projectDir, force: true, quiet: true }), `Pushed ${dim("— merge in Studio")}`);
                    },
                });
                keyboardHandler.start();
            }
        }
        return {
            ready: devServer.ready,
            done,
            stop: shutdown,
        };
    }, {
        "cli.port": options.port,
        "cli.projectDir": options.projectDir,
        "cli.hmr": options.hmr ?? true,
    });
}
