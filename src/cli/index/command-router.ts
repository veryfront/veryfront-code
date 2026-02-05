/**
 * Command routing logic for CLI
 *
 * @module cli/index/command-router
 */

import { formatErrorBox } from "#veryfront/errors/user-friendly/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT, VERSION } from "#veryfront/utils";
import { analyzeChunksCommand } from "../commands/analyze-chunks/index.ts";
import { cleanCommand } from "../commands/clean/index.ts";
import { doctorCommand } from "../commands/doctor/index.ts";
import { initCommand } from "../commands/init/index.ts";
import { installCommand, uninstallCommand } from "../commands/install/index.ts";
import { lockCommand } from "../commands/lock/index.ts";
import { routesCommand } from "../commands/routes/index.ts";
import { handlePullCommand } from "../commands/pull/index.ts";
import { handlePushCommand } from "../commands/push/index.ts";
import { handleMergeCommand } from "../commands/merge/index.ts";
import { handleDeployCommand } from "../commands/deploy/index.ts";
import { handleUpCommand } from "../commands/up/index.ts";
import { handleNewCommand } from "../commands/new/index.ts";
import { handleIssuesCommand } from "../commands/issues/index.ts";
import { login, logout, whoami } from "../auth/index.ts";
import { showCommandHelp, showMainHelp } from "../help/index.ts";
import {
  exitProcess,
  registerTerminationSignals,
  setColorMode,
  setQuietMode,
  setVerboseMode,
  showLogo,
} from "../utils/index.ts";
import { handleBuildCommand } from "../commands/build/handler.ts";
import { handleDevCommand } from "../commands/dev/handler.ts";
import { handleGenerateCommand } from "../commands/generate/handler.ts";
import { handleStudioCommand } from "../commands/studio/handler.ts";
import { handleStartCommand } from "../commands/start/handler.ts";
import type { ParsedArgs } from "./types.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import type { IntegrationName } from "../templates/types.ts";
import { generateDefaultProjectId } from "../utils/project.ts";

/**
 * Show help for a specific command or main help
 */
function showHelp(command?: string): void {
  if (command) {
    showCommandHelp(command);
    return;
  }
  showMainHelp();
}

function resolvePath(path: string): string {
  return path.startsWith("/") ? path : join(cwd(), path);
}

function parseLoginMethod(
  args: ParsedArgs,
): "google" | "github" | "microsoft" | "token" | undefined {
  if (args.google) return "google";
  if (args.github) return "github";
  if (args.microsoft) return "microsoft";
  if (args.token) return "token";
  return undefined;
}

function getStringArg(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = args[key];
    if (val) return String(val);
  }
  return undefined;
}

/**
 * Route and execute the appropriate CLI command
 *
 * @param args - Parsed CLI arguments
 */
export async function routeCommand(args: ParsedArgs): Promise<void> {
  if (args["no-color"]) setColorMode(false);
  else if (args.color) setColorMode(true);

  if (args.verbose) setVerboseMode(true);
  else if (args.quiet || args.q) setQuietMode(true);

  if (args.version || args.v) {
    cliLogger.info(`Veryfront CLI v${VERSION}`);
    exitProcess(0);
    return;
  }

  const command = args._[0] as string | undefined;

  if (args.help || args.h) {
    showHelp(command);
    exitProcess(0);
    return;
  }

  try {
    switch (command) {
      case "init": {
        let name = args._[1] as string | undefined;
        let template = (args.t || args.template) as InitTemplate | undefined;
        let integrations: IntegrationName[] | undefined;
        let skipInstall = Boolean(args["skip-install"]);
        let skipEnvPrompt = Boolean(args["skip-env-prompt"]);
        let env: Record<string, string> | undefined;

        const configPath = args.config || args.c;
        if (configPath) {
          const fs = createFileSystem();
          const resolvedPath = resolvePath(String(configPath));

          try {
            const configContent = await fs.readTextFile(resolvedPath);
            const config = JSON.parse(configContent) as {
              name?: string;
              template?: InitTemplate;
              integrations?: IntegrationName[];
              skipInstall?: boolean;
              skipEnvPrompt?: boolean;
              env?: Record<string, string>;
            };

            name ||= config.name;
            template ||= config.template;
            integrations ||= config.integrations;
            skipInstall ||= config.skipInstall ?? false;
            skipEnvPrompt ||= config.skipEnvPrompt ?? false;
            env = config.env;

            cliLogger.debug(`Loaded config from ${resolvedPath}`);
          } catch (error) {
            cliLogger.error(`Failed to read config file: ${resolvedPath}`);
            if (error instanceof SyntaxError) cliLogger.error("Invalid JSON syntax in config file");
            exitProcess(1);
            return;
          }
        }

        if (args.integrations) {
          integrations = String(args.integrations)
            .split(",")
            .map((s) => s.trim()) as IntegrationName[];
        }

        await initCommand({
          name,
          template,
          skipInstall,
          skipEnvPrompt,
          integrations,
          env,
        });
        break;
      }

      case "dev":
        await handleDevCommand(args);
        break;

      case "build":
        showLogo();
        await handleBuildCommand(args);
        exitProcess(0);
        break;

      case "preview":
      case "serve": {
        const mode = (args.mode || args.m || "renderer") as "combined" | "proxy" | "renderer";
        const port = args.port ?? DEFAULT_DEV_SERVER_PORT;
        const bindAddress = String(args.hostname || args.host || "0.0.0.0");
        const splitMode = Boolean(args.split);

        // Split mode: run proxy and renderer as separate processes
        if (splitMode) {
          showLogo();
          const { runSplitMode } = await import("../commands/serve-split.ts");
          const useBinary = Boolean(args.binary);
          const binaryPath = typeof args.binary === "string" ? args.binary : "./bin/veryfront";
          // Use explicit ports: renderer on 3000, proxy on 8080 (or user-specified if different from default)
          // args.port defaults to DEFAULT_DEV_SERVER_PORT (3000), so only use it if explicitly different
          const proxyPort = port !== DEFAULT_DEV_SERVER_PORT ? Number(port) : 8080;
          await runSplitMode({
            rendererPort: 3000,
            proxyPort,
            useBinary,
            binaryPath,
          });
          return;
        }

        if (mode === "proxy") {
          showLogo();
          cliLogger.info(`Starting proxy server on ${bindAddress}:${port}`);

          const { setEnv } = await import("#veryfront/platform/compat/process.ts");
          setEnv("PORT", String(port));
          setEnv("HOST", bindAddress);

          // Import and run proxy main
          await import("../../proxy/main.ts");
        } else if (mode === "renderer" || mode === "combined") {
          // Renderer mode: run SSR production server
          showLogo();

          // Clear stale ESM caches to prevent module resolution issues
          const { clearAllLocalCaches } = await import(
            "../../transforms/mdx/esm-module-loader/cache/index.ts"
          );
          await clearAllLocalCaches();

          const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
          const adapter = await runtime.get();
          const { startUniversalServer } = await import("#veryfront/server/production-server.ts");

          // Initialize OTLP tracing and distributed caches before starting server
          // This was previously only in production-server.ts's import.meta.main block,
          // which doesn't run when imported as a module via CLI
          const { initializeOTLPWithApis } = await import(
            "#veryfront/observability/tracing/otlp-setup.ts"
          );
          const { initializeDistributedCaches } = await import(
            "#veryfront/cache/distributed-cache-init.ts"
          );
          await Promise.allSettled([
            initializeOTLPWithApis(),
            initializeDistributedCaches(),
          ]);

          const projectDir = cwd();
          const debug = Boolean(args.debug);
          const shutdownController = new AbortController();

          // Generate default project ID for local filesystem mode
          const defaultProjectId = generateDefaultProjectId(projectDir);

          const server = await startUniversalServer({
            projectDir,
            port,
            bindAddress,
            debug,
            adapter,
            signal: shutdownController.signal,
            defaultProjectSlug: defaultProjectId,
            defaultProjectId,
          });
          await server.ready;

          let shuttingDown = false;
          const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
            if (shuttingDown) return;
            shuttingDown = true;

            cliLogger.info(`Received ${signal}, shutting down production server...`);
            try {
              shutdownController.abort();
              await server.stop();
            } catch (error) {
              cliLogger.warn("Error while shutting down production server:", error);
            } finally {
              exitProcess(0);
            }
          };

          registerTerminationSignals((signal) => {
            void shutdown(signal);
          });

          await new Promise(() => {
            /* never resolve */
          });
        }

        break;
      }

      case "doctor":
        showLogo();
        await doctorCommand(cwd(), { strict: Boolean(args.strict || args.s) });
        break;

      case "clean":
        showLogo();
        await cleanCommand({
          projectDir: cwd(),
          cache: Boolean(args.cache),
          build: Boolean(args.build),
          all: Boolean(args.all),
          force: Boolean(args.force || args.f),
        });
        break;

      case "analyze-chunks":
        showLogo();
        await analyzeChunksCommand({
          projectDir: cwd(),
          output: getStringArg(args, "output", "o"),
        });
        break;

      case "routes":
        showLogo();
        await routesCommand(cwd(), { json: Boolean(args.json || args.j) });
        break;

      case "studio":
        await handleStudioCommand(args);
        break;

      case "lock":
        showLogo();
        await lockCommand({
          projectDir: cwd(),
          update: Boolean(args.update || args.u),
          verify: Boolean(args.verify),
          clear: Boolean(args.clear),
          list: Boolean(args.list || args.l),
          force: Boolean(args.force || args.f),
        });
        break;

      case "generate":
      case "g":
        showLogo();
        await handleGenerateCommand(args);
        break;

      case "pull":
        showLogo();
        await handlePullCommand(args);
        break;

      case "push":
        showLogo();
        await handlePushCommand(args);
        break;

      case "merge":
        showLogo();
        await handleMergeCommand(args);
        break;

      case "deploy":
        showLogo();
        await handleDeployCommand(args);
        break;

      case "up":
        await handleUpCommand(args);
        break;

      case "new":
        await handleNewCommand(args);
        break;

      case "login":
        await login(parseLoginMethod(args));
        break;

      case "logout":
        await logout();
        break;

      case "whoami":
        await whoami();
        break;

      case "install":
        await installCommand({
          target: getStringArg(args, "target"),
          global: Boolean(args.global),
          force: Boolean(args.force || args.f),
        });
        break;

      case "uninstall":
        await uninstallCommand({
          target: getStringArg(args, "target"),
          global: Boolean(args.global),
          force: Boolean(args.force || args.f),
        });
        break;

      case "demo": {
        const { demoCommand } = await import("../commands/demo/index.ts");
        await demoCommand({
          projectName: args._[1] ? String(args._[1]) : undefined,
          auto: Boolean(args.auto),
          loginMethod: args.login
            ? (String(args.login) as "google" | "github" | "microsoft" | "token")
            : undefined,
        });
        break;
      }

      case "mcp": {
        // args.port defaults to DEFAULT_PORT (3000) from the CLI parser.
        // The standalone MCP targets the dev server at 8080. Only override
        // if the user explicitly passed --port.
        const { DEFAULT_PORT } = await import("#veryfront/config/defaults.ts");
        const port = args.port !== DEFAULT_PORT ? Number(args.port) : undefined;
        const { createStandaloneMCPServer } = await import("../mcp/standalone.ts");
        const mcpServer = createStandaloneMCPServer({ port });
        await new Promise(() => {});
        mcpServer.stop();
        break;
      }

      case "issues":
        await handleIssuesCommand(args);
        break;

      case "help":
        showHelp();
        exitProcess(0);
        return;

      case undefined:
        await handleStartCommand(args);
        break;

      default:
        cliLogger.error(`Unknown command: ${command}\n`);
        showHelp();
        exitProcess(1);
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log();
    console.log(formatErrorBox(new Error(message)));
    console.log();
    exitProcess(1);
  }
}
