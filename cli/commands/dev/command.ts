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
import { yellow } from "#cli/ui";
import { exitProcess, registerTerminationSignals } from "#cli/utils";
import { banner, brand, dim, error as errorColor, success } from "#cli/ui";
import { applyRuntimeAuthContext } from "#cli/shared/runtime-auth";
import { createKeyboardHandler, type KeyboardHandler } from "../../ui/keyboard.ts";
import { openBrowser } from "../../auth/browser.ts";
import { createMCPServer, type MCPDevServer } from "../../mcp/server.ts";
import { withSpan } from "veryfront/observability/otlp-setup";
import {
  type AuthIdentity,
  isApiKeyIdentity,
  login,
  validateCredential,
} from "../../auth/login.ts";
import { fetchRemoteProjects, type RemoteProject } from "../../sync/index.ts";
import { pullCommand } from "../pull/index.ts";
import { pushCommand } from "../push/index.ts";

export interface DevOptions {
  port: number;
  projectDir: string;
  hmr?: boolean;
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

  const identity = await validateCredential(apiToken);
  if (!identity) return { identity: null, projects: [] };

  const result = await fetchRemoteProjects(apiToken);
  return { identity, projects: result.projects };
}

export function devCommand(options: DevOptions): Promise<DevCommandResult> {
  return withSpan(
    "cli.command.dev",
    async () => {
      const { port, projectDir, hmr = true, demoMode = false } = options;

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
      const runtimeAuth = await applyRuntimeAuthContext({
        projectDir,
        projectSlug: config?.fs?.veryfront?.projectSlug ?? env.projectSlug,
      });
      const projectSlug = runtimeAuth.projectSlug;

      // Validate provider config and print warnings (framework returns plain text, CLI adds colors)
      const aiValidation = validateProviderConfig(config);
      if (aiValidation.warnings.length > 0) {
        console.log("");
        for (const warning of aiValidation.warnings) {
          console.log(`  ${yellow("!")} ${warning.replace(/\n/g, "\n    ")}`);
        }
        console.log("");
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

      // Check for existing auth
      try {
        const initialAuth = await preloadDevAuth(runtimeAuth.apiToken);
        identity = initialAuth.identity;
        projects = initialAuth.projects;
      } catch {
        // Auth check failed - non-fatal
      }

      let keyboardHandler: KeyboardHandler | null = null;
      let shuttingDown = false;

      async function runSyncAction(action: () => Promise<void>, successMsg: string): Promise<void> {
        try {
          await action();
          console.log(`  ${success("✓")} ${successMsg}`);
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

      console.log();
      console.log(
        banner({
          title: "Veryfront",
          subtitle: "is running",
          info: {
            url: serverUrl,
            ...(projectSlug ? { project: projectSlug } : {}),
            ...(mcpServer ? { mcp: `http://veryfront.me:${mcpPort}/mcp` } : {}),
          },
        }),
      );
      console.log();
      console.log(`  ${success("✓")} Server ready at ${brand(serverUrl)}`);
      if (mcpServer) {
        console.log(
          `  ${success("✓")} MCP ready at ${brand(`http://veryfront.me:${mcpPort}/mcp`)}`,
        );
      }
      console.log();

      // Context-aware next step hint
      if (!identity) {
        console.log(`  ${dim("To sync with Veryfront: press")} ${brand("a")} ${dim("to login")}`);
      } else if (projects.length > 0) {
        console.log(`  ${success("✓")} ${authStatus(identity)}`);
        console.log(
          `  ${dim("Press")} ${brand("s")} ${dim("to select a project, then")} ${brand("p")} ${
            dim(
              "to pull",
            )
          }`,
        );
      } else {
        console.log(`  ${success("✓")} ${authStatus(identity)}`);
        console.log(`  ${dim("Press")} ${brand("s")} ${dim("to see your projects")}`);
      }
      console.log();

      if (!demoMode) {
        keyboardHandler = createKeyboardHandler({
          onOpen: () => void openBrowser(serverUrl),
          onClear: () => console.clear(),
          onQuit: () => void shutdown(),
          onAuth: async () => {
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
              `  ${success("✓")} ${authStatus(identity)}${dim(`, ${projects.length} projects`)}`,
            );
          },
          onSync: () => {
            if (!identity) {
              console.log(`  ${dim("Press")} ${brand("a")} ${dim("to login")}`);
              return;
            }

            if (projects.length === 0) {
              console.log(`  ${dim("No projects")}`);
              return;
            }

            projects.forEach((p, i) => {
              const active = selectedProject?.id === p.id;
              console.log(
                `  ${active ? success("●") : dim("○")} ${brand(String(i + 1))} ${p.name}`,
              );
            });
          },
          onNumber: async (n) => {
            const project = projects[n - 1];
            if (!project) return;

            selectedProject = project;
            console.log(`  ${success("●")} ${project.name} ${dim("— pulling...")}`);
            await runSyncAction(
              () =>
                pullCommand({ projectSlug: project.slug, projectDir, force: true, quiet: true }),
              `Ready ${dim("— p pull / u push")}`,
            );
          },
          onPull: async () => {
            const project = selectedProject;
            if (!project) {
              console.log(`  ${dim("Press s to select project")}`);
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
            if (!selectedProject) {
              console.log(`  ${dim("Press s to select project")}`);
              return;
            }

            console.log(`  ${dim("Pushing...")}`);
            await runSyncAction(
              () => pushCommand({ projectDir, force: true, quiet: true }),
              `Pushed ${dim("— merge in Studio")}`,
            );
          },
        });

        keyboardHandler.start();
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
    },
  );
}
