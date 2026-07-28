/****
 * Dev Command - Development server with HMR
 */

import { compileAllMDX, watchMDX } from "veryfront/build";
import { CONFIG_NOT_FOUND, INITIALIZATION_ERROR } from "veryfront/errors";
import { join } from "veryfront/platform/path";
import { runtime } from "veryfront/platform";
import { getConfig } from "veryfront/config";
import { getEnvironmentConfig } from "veryfront/config";
import { startDevServer } from "veryfront/server";
import { validateProviderConfig } from "veryfront/discovery";
import { brand, devShortcuts, dim, error as errorColor, formatDuration, warning } from "#cli/ui";
import { exitProcess, isTTY, isVerbose, registerTerminationSignals } from "#cli/utils";
import { DEV_SHORTCUTS, shortcutsBlock } from "../../ui/components/shortcuts.ts";
import { applyRuntimeAuthContext, resolveLinkedProjectSlug } from "#cli/shared/runtime-auth";
import { createKeyboardHandler, type KeyboardHandler } from "../../ui/keyboard.ts";
import { openBrowser } from "../../auth/browser.ts";
import { createMCPServer, type MCPDevServer } from "../../mcp/server.ts";
import { withSpan } from "veryfront/observability/otlp-setup";
import { type AuthIdentity, isApiKeyIdentity, login } from "../../auth/login.ts";
import { fetchRemoteProjects, type RemoteProject } from "../../sync/index.ts";
import { pullCommand } from "../pull/index.ts";
import { pushCommand, type PushOptions } from "../push/index.ts";
import { createProjectSelector } from "./project-selector.ts";
import { createDevLogController } from "./log-controller.ts";

export interface DevOptions {
  port: number;
  projectDir: string;
  hmr?: boolean;
  open?: boolean;
  /** Demo mode: don't exit process on shutdown, resolve done promise instead */
  demoMode?: boolean;
}

export type DevCommandOptions = DevOptions;

export interface DevCommandResult {
  ready: Promise<void>;
  done: Promise<void>;
  /** Stop the dev server programmatically (for demo mode) */
  stop: () => Promise<void>;
}

function authStatus(identity: AuthIdentity): string {
  return isApiKeyIdentity(identity)
    ? "Authenticated with an API key"
    : `Logged in as ${identity.email}`;
}

export async function preloadDevAuth(
  apiToken?: string,
): Promise<{ identity: AuthIdentity | null; projects: RemoteProject[] }> {
  if (!apiToken) return { identity: null, projects: [] };

  const result = await fetchRemoteProjects(apiToken);
  const identity = result.credentialType === "apiKey"
    ? result.error ? null : { authenticated: true, type: "apiKey" } as const
    : result.user;
  return { identity, projects: result.projects };
}

export function createSelectedProjectPushOptions(
  projectDir: string,
  project: RemoteProject,
): PushOptions {
  return {
    projectDir,
    projectSlug: project.slug,
    force: true,
    quiet: true,
  };
}

export function devCommand(options: DevOptions): Promise<DevCommandResult> {
  return withSpan(
    "cli.command.dev",
    async () => {
      const { port, projectDir, hmr = true, open = false, demoMode = false } = options;
      const startTime = Date.now();

      let doneResolve: (() => void) | undefined;
      const done = new Promise<void>((resolve) => {
        doneResolve = resolve;
      });

      const adapter = await runtime.get();

      let config: Awaited<ReturnType<typeof getConfig>>;
      try {
        config = await getConfig(projectDir, adapter);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw CONFIG_NOT_FOUND.create({
            detail: "No veryfront.config.js found",
            context: { projectDir },
          });
        }
        throw error;
      }

      const DEFAULT_DEV_PORT = 3000;
      const finalPort = port !== DEFAULT_DEV_PORT ? port : (config?.dev?.port ?? port);
      const enableHMR = config?.dev?.hmr !== false && hmr;

      const env = getEnvironmentConfig();
      const isProxyMode = config?.fs?.veryfront?.proxyMode === true;
      const linkedProjectSlug = await resolveLinkedProjectSlug(
        projectDir,
        config?.projectSlug ?? config?.fs?.veryfront?.projectSlug ?? env.projectSlug,
      );
      const runtimeAuth = await applyRuntimeAuthContext({
        linkedProjectSlug,
      });
      const initialAuthPromise = preloadDevAuth(runtimeAuth.apiToken).catch(() => ({
        identity: null,
        projects: [],
      }));
      // Validate provider config and print warnings (framework returns plain text, CLI adds colors)
      const aiValidation = validateProviderConfig(config);
      if (aiValidation.warnings.length > 0) {
        console.log();
        for (const w of aiValidation.warnings) {
          console.log(`  ${warning("!")} ${w.replace(/\n/g, "\n    ")}`);
        }
        console.log();
      }

      if (config?.experimental?.precompileMDX) {
        const outputDir = join(projectDir, ".veryfront", "compiled");
        try {
          await compileAllMDX({ projectDir, outputDir, mode: "development" });
          void watchMDX({ projectDir, outputDir, mode: "development" });
        } catch {
          // MDX pre-compilation failed
        }
      }

      const shutdownController = new AbortController();
      let devServer: Awaited<ReturnType<typeof startDevServer>> | null = null;
      let mcpServer: MCPDevServer | null = null;

      // Sync state
      let identity: AuthIdentity | null = null;
      let projects: RemoteProject[] = [];
      let selectedProject: RemoteProject | null = null;

      try {
        devServer = await startDevServer({
          port: finalPort,
          projectDir,
          enableHMR,
          enableFastRefresh: true,
          signal: shutdownController.signal,
        });
      } catch (error) {
        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("eaddrinuse") || msg.includes("address already in use")) {
            throw INITIALIZATION_ERROR.create({
              detail: `Port ${finalPort} is already in use`,
              context: { port: finalPort },
            });
          }
        }
        throw error;
      }

      const DEV_MCP_PORT_OFFSET = 2;
      const mcpPort = finalPort + DEV_MCP_PORT_OFFSET;
      try {
        mcpServer = await createMCPServer({ httpPort: mcpPort });
      } catch {
        // MCP server failed to start - non-fatal, continue without it
      }

      const authReady = initialAuthPromise.then((initialAuth) => {
        identity = initialAuth.identity;
        projects = initialAuth.projects;
      });
      void authReady;

      let keyboardHandler: KeyboardHandler | null = null;
      let shuttingDown = false;
      const projectSelector = createProjectSelector({
        prepare: () => authReady,
        getProjects: () => projects,
        getSelectedProjectId: () => selectedProject?.id ?? null,
        pauseKeyboard: () => keyboardHandler?.stop(),
        resumeKeyboard: () => keyboardHandler?.start(),
        onEmpty: () => {
          if (!identity) {
            console.log(`  Press ${brand("a")} to sign in`);
            return;
          }
          console.log("  No projects found");
        },
        onInterrupt: () => void shutdown(),
        onSelect: (project) => {
          selectedProject = project;
        },
      });

      async function runSyncAction(action: () => Promise<void>, successMsg: string): Promise<void> {
        try {
          await action();
          console.log(`  ✓ ${successMsg}`);
        } catch (err) {
          console.log(`  ${errorColor("✗")} ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      async function shutdown(): Promise<void> {
        if (shuttingDown) {
          if (!demoMode) exitProcess(0);
          return;
        }
        shuttingDown = true;

        const timeout = demoMode ? null : setTimeout(() => exitProcess(0), 3000);

        try {
          keyboardHandler?.stop();
          shutdownController.abort();
          await mcpServer?.stop();
          await devServer?.stop();
        } catch {
          // ignore
        } finally {
          if (timeout) clearTimeout(timeout);
        }

        if (demoMode) {
          doneResolve?.();
          return;
        }

        exitProcess(0);
      }

      registerTerminationSignals(() => void shutdown());

      if (isProxyMode) {
        return {
          ready: devServer.ready,
          done,
          stop: shutdown,
        };
      }

      const serverUrl = `http://veryfront.me:${finalPort}`;
      const elapsed = Date.now() - startTime;

      console.log();
      console.log(`  ✓ Ready in ${formatDuration(elapsed)}`);
      console.log(`  ${brand(serverUrl)}`);
      if (mcpServer && isVerbose()) {
        console.log(`  ${dim("MCP")} ${brand(`http://veryfront.me:${mcpPort}/mcp`)}`);
      }
      if (isTTY()) {
        console.log(devShortcuts());
      }
      console.log();

      if (open) {
        try {
          await openBrowser(serverUrl);
        } catch {
          console.log(`  ${dim("Could not open browser automatically.")}`);
        }
      }

      if (!demoMode) {
        const logs = createDevLogController();
        keyboardHandler = createKeyboardHandler({
          onHelp: () => {
            console.log();
            console.log(shortcutsBlock(DEV_SHORTCUTS));
            console.log();
          },
          onOpen: () => void openBrowser(serverUrl),
          onLogs: () => {
            const verbose = logs.toggle();
            console.log(`  Verbose logs ${verbose ? brand("on") : "off"}`);
          },
          onClear: () => console.clear(),
          onQuit: () => void shutdown(),
          onAuth: async () => {
            await authReady;
            if (identity) {
              console.log(
                `  ${dim(authStatus(identity))}${dim(", press s to select a project")}`,
              );
              return;
            }

            console.log(`  ${dim("Opening browser...")}`);
            const result = await login();
            if (!result) return;

            identity = result;
            const projectResult = await fetchRemoteProjects();
            projects = projectResult.projects;
            console.log(
              `  ✓ ${authStatus(identity)}${dim(`, ${projects.length} projects`)}`,
            );
          },
          onSync: () => void projectSelector.open(),
          onPull: async () => {
            const project = selectedProject;
            if (!project) {
              console.log(`  Press ${brand("s")} to select a project`);
              return;
            }

            console.log(`  ${dim("Pulling...")}`);
            await runSyncAction(
              () =>
                pullCommand({ projectSlug: project.slug, projectDir, force: true, quiet: true }),
              "Pulled",
            );
          },
          onPush: async () => {
            const project = selectedProject;
            if (!project) {
              console.log(`  Press ${brand("s")} to select a project`);
              return;
            }

            console.log(`  ${dim("Pushing...")}`);
            await runSyncAction(
              () => pushCommand(createSelectedProjectPushOptions(projectDir, project)),
              `Pushed ${dim("— merge in Studio")}`,
            );
          },
        });

        keyboardHandler.start();
        if (isTTY()) console.log(`  ${brand("?")} shortcuts`);
      }

      return {
        ready: devServer.ready,
        done,
        stop: shutdown,
      };
    },
    {
      "cli.port": options.port,
      "cli.projectDir": options.projectDir,
      "cli.hmr": options.hmr ?? true,
      "cli.open": options.open ?? false,
    },
  );
}
