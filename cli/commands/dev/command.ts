/****
 * Dev Command - Development server with HMR
 */

import { compileAllMDX, watchMDX } from "veryfront/build";
import { CONFIG_NOT_FOUND, PORT_IN_USE } from "veryfront/errors";
import { join } from "veryfront/platform/path";
import { runtime } from "#cli/runtime-adapter";
import { getEnv } from "veryfront/platform";
import { getConfig } from "veryfront/config";
import { getEnvironmentConfig } from "veryfront/config";
import { startDevServer } from "veryfront/server";
import { clearAllLocalCaches } from "veryfront/transforms/mdx-cache";
import { isPersistentLocalCacheEnabled } from "veryfront/cache";
import { validateProviderConfig } from "veryfront/discovery";
import { brand, devShortcuts, dim, error as errorColor, formatDuration, warning } from "#cli/ui";
import { exitProcess, isTTY, isVerbose, registerTerminationSignals } from "#cli/utils";
import { DEV_SHORTCUTS, shortcutsBlock } from "../../ui/components/shortcuts.ts";
import { applyQualifiedRuntimeAuth, resolveLinkedProjectSlug } from "#cli/shared/runtime-auth";
import { createKeyboardHandler, type KeyboardHandler } from "../../ui/keyboard.ts";
import { openBrowser } from "../../auth/browser.ts";
import { createMCPServer, type MCPDevServer } from "../../mcp/server.ts";
import { withSpan } from "veryfront/observability/otlp-setup";
import { type AuthIdentity, isApiKeyIdentity, login } from "../../auth/login.ts";
import { fetchRemoteProjects, type RemoteProject } from "../../sync/index.ts";
import { pullCommand } from "../pull/index.ts";
import { createStagedPushOptions, pushCommand, type PushOptions } from "../push/index.ts";
import { createProjectSelector } from "./project-selector.ts";
import { createDevLogController } from "./log-controller.ts";
import { findAvailablePort, isPortAvailable, isPortInUseError } from "./port-fallback.ts";
import { advertisesCloudGateway, listInferenceOptions } from "./inference-status.ts";
import { captureHostApiEnvironment } from "#cli/process-env";
import { resolveApiCredentialCandidatesForAuth, resolveApiUrlTrust } from "#cli/shared/config";

export interface DevOptions {
  port: number;
  /**
   * True when the port was set explicitly by a `--port` / `-p` flag or by a
   * valid `PORT` / `VERYFRONT_PORT` env var.  When false (or absent) the port
   * value fell through to the hardcoded default and `config.dev.port` should
   * take precedence.  Defaults to `port !== DEFAULT_DEV_PORT` for callers that
   * do not set this field, preserving backward-compatible behaviour.
   */
  portExplicit?: boolean;
  projectDir: string;
  hmr?: boolean;
  open?: boolean;
  /** Demo mode: don't exit process on shutdown, resolve done promise instead */
  demoMode?: boolean;
  /**
   * Clear the shared on-disk ESM caches before starting. Only honoured once the
   * requested dev port is confirmed free, because the cache directory is shared
   * with any dev server already serving this project.
   */
  clearLocalCaches?: boolean;
}

export type DevCommandOptions = DevOptions;

export interface DevCommandResult {
  ready: Promise<void>;
  done: Promise<void>;
  /**
   * The port the server actually bound, which is not always the requested one:
   * a taken port falls forward. Embedded callers must use this rather than the
   * port they asked for, or they will point the user at the process that caused
   * the collision.
   */
  port: number;
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
  projectDir?: string,
): Promise<{ identity: AuthIdentity | null; projects: RemoteProject[] }> {
  const env = getEnvironmentConfig();
  const trust = resolveApiUrlTrust(env, null);
  const candidates = await resolveApiCredentialCandidatesForAuth(
    env,
    projectDir,
    true,
  );
  const candidate = apiToken
    ? candidates.find((entry) => entry.apiToken === apiToken)
    : candidates[0];

  // Direct callers can supply an explicit token without loading it into the
  // process environment. That remains valid only when the repository did not
  // choose the destination. A repository-steered destination requires the
  // resolver's source-qualified token and its paired validation environment.
  if (!candidate && (!apiToken || trust.repositorySteered)) {
    return { identity: null, projects: [] };
  }

  const result = await fetchRemoteProjects(
    candidate?.apiToken ?? apiToken,
    candidate?.validationEnv ?? env,
  );
  const identity = result.credentialType === "apiKey"
    ? result.error ? null : { authenticated: true, type: "apiKey" } as const
    : result.user;
  return { identity, projects: result.projects };
}

/**
 * Run the interactive login behind the `a` shortcut and report a refusal.
 *
 * The keyboard handler dispatches shortcuts without awaiting them, so a
 * rejection escapes as an unhandled promise rejection and tears the dev server
 * down. `login()` now refuses when a repository chose the API endpoint, and
 * that refusal is exactly the message the developer must read, so print it on
 * the dev output line instead of letting it escape.
 */
export async function loginForDevShortcut(
  attemptLogin: () => Promise<AuthIdentity | null> = login,
): Promise<AuthIdentity | null> {
  try {
    return await attemptLogin();
  } catch (err) {
    console.log(`  ${errorColor("✗")} ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function createSelectedProjectPushOptions(
  projectDir: string,
  project: RemoteProject,
): PushOptions {
  return createStagedPushOptions(project.slug, projectDir);
}

/**
 * Starts the dev server on the first free port at or after `requestedPort`.
 *
 * Port 3000 is the most contended port on a developer machine, and the docs
 * tell readers to run a bare `veryfront dev`, so a taken port scans forward
 * rather than killing the command. Everything downstream - the MCP port, the
 * printed URL, the browser the demo opens - must key off the returned `port`
 * rather than the requested one, or a fall-forward points the user at the
 * process that caused the collision.
 *
 * Takes `start` as a callback so the whole scan costs one `DevServer.start()`:
 * probing is a bare bind/release, and a failed `start()` has already registered
 * watchers and reload subscriptions that only `stop()` releases.
 */
export async function startDevServerOnFreePort<T>(
  requestedPort: number,
  start: (port: number) => Promise<T>,
): Promise<{ server: T; port: number }> {
  const port = await findAvailablePort(requestedPort);
  // Port 0 asked for any free port, so landing elsewhere took nothing away.
  if (requestedPort !== 0 && port !== requestedPort) {
    console.log();
    console.log(`  ${warning("!")} Port ${requestedPort} is in use, using ${port} instead`);
  }

  try {
    return { server: await start(port), port };
  } catch (error) {
    // Lost the race between probing the port and binding it.
    if (isPortInUseError(error)) {
      throw PORT_IN_USE.create({
        detail: `Port ${port} is already in use`,
        cause: error,
        context: { port },
      });
    }
    throw error;
  }
}

/**
 * Clears the shared on-disk ESM caches, but only if they are safe to remove.
 *
 * The caches live under the project's `.cache` directory, which every dev
 * server rooted at that project shares. A taken dev port is the signal that one
 * of them is already running and still serving modules it compiled, so the
 * clear is skipped rather than wiping that server's work out from under it -
 * the second `veryfront dev` falls forward to a free port and starts on a cache
 * it did not just destroy.
 *
 * The clear is also skipped when the project keeps a persistent local dev
 * cache. That cache stores compiled modules that reference these files, so
 * removing them makes every entry fail validation and turns each restart cold
 * again. Run `veryfront clean --cache` to reset both.
 *
 * Returns whether the clear ran. Takes `clear`, `probe`, and `persists` as
 * parameters so the decision can be tested without booting a dev server, the
 * same seam `startDevServerOnFreePort` uses.
 */
export async function clearLocalCachesIfPortFree(
  requestedPort: number,
  clear: () => Promise<void> = clearAllLocalCaches,
  probe: (port: number) => Promise<boolean> = isPortAvailable,
  persists: () => boolean = isPersistentLocalCacheEnabled,
): Promise<boolean> {
  if (!await probe(requestedPort)) return false;
  if (persists()) return false;
  await clear();
  return true;
}

export function devCommand(options: DevOptions): Promise<DevCommandResult> {
  return withSpan(
    "cli.command.dev",
    async () => {
      const {
        port,
        portExplicit,
        projectDir,
        hmr = true,
        open = false,
        demoMode = false,
        clearLocalCaches = false,
      } = options;
      const startTime = Date.now();

      captureHostApiEnvironment();

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
      // Use `portExplicit` when provided so that `PORT=3000` is honoured even
      // though 3000 equals the default — the old sentinel `port !== 3000` would
      // silently discard an explicit env-var request that happens to equal the
      // default value.  Fall back to the sentinel for callers that predate this
      // field.
      const finalPort = (portExplicit ?? port !== DEFAULT_DEV_PORT)
        ? port
        : (config?.dev?.port ?? port);
      const enableHMR = config?.dev?.hmr !== false && hmr;

      if (clearLocalCaches) await clearLocalCachesIfPortFree(finalPort);

      const env = getEnvironmentConfig();
      const isProxyMode = config?.fs?.veryfront?.proxyMode === true;
      const linkedProjectSlug = await resolveLinkedProjectSlug(
        projectDir,
        config?.projectSlug ?? config?.fs?.veryfront?.projectSlug ?? env.projectSlug,
      );
      const runtimeAuth = await applyQualifiedRuntimeAuth(projectDir, linkedProjectSlug);
      const initialAuthPromise = preloadDevAuth(runtimeAuth.apiToken, projectDir).catch(() => ({
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

      const started = await startDevServerOnFreePort(finalPort, (port) =>
        startDevServer({
          port,
          projectDir,
          enableHMR,
          enableFastRefresh: true,
          signal: shutdownController.signal,
        }));
      devServer = started.server;
      const boundPort = started.port;

      const DEV_MCP_PORT_OFFSET = 2;
      const mcpPort = boundPort + DEV_MCP_PORT_OFFSET;
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
          port: boundPort,
          stop: shutdown,
        };
      }

      const serverUrl = `http://localhost:${boundPort}`;
      const elapsed = Date.now() - startTime;

      console.log();
      console.log(`  ✓ Ready in ${formatDuration(elapsed)}`);
      console.log(`  ${brand(serverUrl)}`);
      const inferenceOptions = listInferenceOptions({
        apiToken: runtimeAuth.apiToken,
        projectSlug: runtimeAuth.projectSlug,
        openaiApiKey: getEnv("OPENAI_API_KEY"),
        openaiBaseUrl: getEnv("OPENAI_BASE_URL"),
        anthropicApiKey: getEnv("ANTHROPIC_API_KEY"),
        googleApiKey: getEnv("GOOGLE_API_KEY") ?? getEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
        mistralApiKey: getEnv("MISTRAL_API_KEY"),
      });
      if (inferenceOptions.length > 0) {
        console.log(`  ${dim("Inference")} ${brand(inferenceOptions.join(", "))}`);
      }
      // The banner reports configured paths, and it must not block Ready on a
      // network round-trip (see `void authReady` above). But an expired stored
      // session still has a nonempty token, so the gateway would be advertised
      // and then fail on first request. The validation is already in flight —
      // let it correct the record rather than delay the banner.
      if (advertisesCloudGateway(inferenceOptions)) {
        void authReady.then(() => {
          if (identity) return;
          console.log(
            `  ${
              warning("!")
            } Veryfront Cloud session is not valid; gateway inference will fail. ` +
              `Run ${brand("veryfront login")} to renew it.`,
          );
        });
      }
      if (mcpServer && isVerbose()) {
        console.log(`  ${dim("MCP")} ${brand(`http://localhost:${mcpPort}/mcp`)}`);
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
            const result = await loginForDevShortcut();
            if (!result) return;

            identity = result;
            const projectResult = await preloadDevAuth(undefined, projectDir);
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
            const pushOptions = createSelectedProjectPushOptions(projectDir, project);
            await runSyncAction(
              () => pushCommand(pushOptions),
              `Pushed to ${pushOptions.branch} ${dim("- merge in Studio")}`,
            );
          },
        });

        keyboardHandler.start();
      }

      return {
        ready: devServer.ready,
        done,
        port: boundPort,
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
