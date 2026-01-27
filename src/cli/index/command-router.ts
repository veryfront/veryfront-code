/**
 * Command routing logic for CLI
 *
 * @module cli/index/command-router
 */

import { handleError } from "#veryfront/errors";
import { formatErrorBox } from "#veryfront/errors/user-friendly/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT, VERSION } from "#veryfront/utils";
import { z } from "zod";
import { analyzeChunksCommand } from "../commands/analyze-chunks.ts";
import { cleanCommand } from "../commands/clean.ts";
import { doctorCommand } from "../commands/doctor/index.ts";
import { initCommand } from "../commands/init/index.ts";
import { installCommand, uninstallCommand } from "../commands/install/index.ts";
import { lockCommand } from "../commands/lock.ts";
import { routesCommand } from "../commands/routes.ts";
import { pullCommand } from "../commands/pull.ts";
import { pushCommand } from "../commands/push.ts";
import { mergeCommand, parseMergeArgs } from "../commands/merge.ts";
import { deployCommand, parseDeployArgs } from "../commands/deploy.ts";
import { parseUpArgs, upCommand } from "../commands/up.ts";
import { newCommand, parseNewArgs } from "../commands/new.ts";
import { promptProjectName } from "../commands/main.ts";
import { issuesCommand } from "../commands/issues.ts";
import { login, logout, whoami } from "../auth/index.ts";
import { COMMANDS } from "../help/command-definitions.ts";
import { showCommandHelp, showMainHelp } from "../help/index.ts";
import {
  exitProcess,
  registerTerminationSignals,
  setColorMode,
  setQuietMode,
  setVerboseMode,
  showLogo,
} from "../utils/index.ts";
import { handleBuildCommand } from "./build-handler.ts";
import { handleDevCommand } from "./dev-handler.ts";
import { handleGenerateCommand } from "./generate-handler.ts";
import { handleStudioCommand } from "./studio-handler.ts";
import { handleStartCommand } from "./start-handler.ts";
import type { ParsedArgs } from "./types.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import type { IntegrationName } from "../templates/types.ts";

/**
 * Handle validation errors using central COMMANDS registry for usage
 */
function handleValidationError(error: z.ZodError, commandName: string): void {
  const issues = error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  cliLogger.error(`Invalid ${commandName} arguments:\n${issues}`);

  const command = COMMANDS[commandName];
  if (command?.usage) {
    cliLogger.info(`Usage: ${command.usage}`);
  }
}

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

function resolveProjectDir(args: ParsedArgs, keys: Array<keyof ParsedArgs>): string {
  const raw = keys.map((k) => args[k]).find((v) => v != null);
  if (!raw) return cwd();

  const dir = String(raw);
  return dir.startsWith("/") ? dir : join(cwd(), dir);
}

function parseCsvArg(value: unknown): string[] | undefined {
  if (!value) return undefined;
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

/**
 * Route and execute the appropriate CLI command
 *
 * @param args - Parsed CLI arguments
 */
export async function routeCommand(args: ParsedArgs): Promise<void> {
  if (args["no-color"]) {
    setColorMode(false);
  } else if (args.color) {
    setColorMode(true);
  }

  if (args.verbose) {
    setVerboseMode(true);
  } else if (args.quiet || args.q) {
    setQuietMode(true);
  }

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
          const configPathStr = String(configPath);
          const resolvedPath = configPathStr.startsWith("/")
            ? configPathStr
            : join(cwd(), configPathStr);

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

            name = name || config.name;
            template = template || config.template;
            integrations = integrations || config.integrations;
            skipInstall = skipInstall || config.skipInstall || false;
            skipEnvPrompt = skipEnvPrompt || config.skipEnvPrompt || false;
            env = config.env;

            cliLogger.debug(`Loaded config from ${resolvedPath}`);
          } catch (error) {
            cliLogger.error(`Failed to read config file: ${resolvedPath}`);
            if (error instanceof SyntaxError) {
              cliLogger.error("Invalid JSON syntax in config file");
            }
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

        if (mode === "proxy") {
          // Proxy-only mode: run OAuth token proxy
          showLogo();
          cliLogger.info(`Starting proxy server on ${bindAddress}:${port}`);

          // Set environment variables for proxy
          const { setEnv } = await import("#veryfront/platform/compat/process.ts");
          setEnv("PORT", String(port));
          setEnv("HOST", bindAddress);

          // Import and run proxy main
          await import("../../../proxy/main.ts");
        } else if (mode === "renderer" || mode === "combined") {
          // Renderer mode: run SSR production server
          showLogo();

          const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
          const adapter = await runtime.get();
          const { startUniversalServer } = await import("#veryfront/server/production-server.ts");

          const projectDir = cwd();
          const debug = Boolean(args.debug);
          const shutdownController = new AbortController();

          const server = await startUniversalServer({
            projectDir,
            port,
            bindAddress,
            debug,
            adapter,
            signal: shutdownController.signal,
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
        await doctorCommand(cwd(), { strict: Boolean(args.strict) || Boolean(args.s) });
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
          output: args.output ? String(args.output) : args.o ? String(args.o) : undefined,
        });
        break;

      case "routes":
        showLogo();
        await routesCommand(cwd(), { json: Boolean(args.json) || Boolean(args.j) });
        break;

      case "studio":
        await handleStudioCommand(args);
        break;

      case "lock":
        showLogo();
        await lockCommand({
          projectDir: cwd(),
          update: Boolean(args.update) || Boolean(args.u),
          verify: Boolean(args.verify),
          clear: Boolean(args.clear),
          list: Boolean(args.list) || Boolean(args.l),
          force: Boolean(args.force) || Boolean(args.f),
        });
        break;

      case "generate":
      case "g":
        showLogo();
        await handleGenerateCommand(args);
        break;

      case "pull": {
        showLogo();

        const projectSlug = args._.length > 1 ? String(args._[1]) : undefined;
        const projects = parseCsvArg(args.projects);

        const projectDir = resolveProjectDir(args, ["project-dir", "dir", "d"]);

        await pullCommand({
          projectSlug,
          projects,
          projectDir,
          branch: args.branch ? String(args.branch) : args.b ? String(args.b) : undefined,
          env: args.env ? String(args.env) : undefined,
          release: args.release ? String(args.release) : undefined,
          force: Boolean(args.force) || Boolean(args.f),
          dryRun: Boolean(args["dry-run"]),
        });
        break;
      }

      case "push": {
        showLogo();

        const projectDir = resolveProjectDir(args, ["dir", "d"]);

        await pushCommand({
          projectDir,
          branch: args.branch ? String(args.branch) : args.b ? String(args.b) : undefined,
          force: Boolean(args.force) || Boolean(args.f),
          dryRun: Boolean(args["dry-run"]),
        });
        break;
      }

      case "merge": {
        showLogo();

        const result = parseMergeArgs(args);
        if (!result.success) {
          handleValidationError(result.error, "merge");
          exitProcess(1);
          return;
        }
        await mergeCommand(result.data);
        break;
      }

      case "deploy": {
        showLogo();

        const result = parseDeployArgs(args);
        if (!result.success) {
          handleValidationError(result.error, "deploy");
          exitProcess(1);
          return;
        }
        await deployCommand(result.data);
        break;
      }

      case "up": {
        const result = parseUpArgs(args);
        if (!result.success) {
          handleValidationError(result.error, "up");
          exitProcess(1);
          return;
        }
        await upCommand(result.data);
        break;
      }

      case "new": {
        let name = args._[1] as string;
        if (!name) {
          const prompted = await promptProjectName();
          if (!prompted) {
            exitProcess(0);
            return;
          }
          name = prompted;
        }

        const result = parseNewArgs(args);
        if (!result.success) {
          handleValidationError(result.error, "new");
          exitProcess(1);
          return;
        }
        await newCommand(name, result.data);
        break;
      }

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
          target: args.target ? String(args.target) : undefined,
          global: Boolean(args.global),
          force: Boolean(args.force) || Boolean(args.f),
        });
        break;

      case "uninstall":
        await uninstallCommand({
          target: args.target ? String(args.target) : undefined,
          global: Boolean(args.global),
          force: Boolean(args.force) || Boolean(args.f),
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
        await issuesCommand(args);
        break;

      case "help":
        showHelp();
        exitProcess(0);
        return;

      case undefined:
        // Default: run full TUI dashboard (like `deno task start`)
        await handleStartCommand(args);
        break;

      default:
        cliLogger.error(`Unknown command: ${command}\n`);
        showHelp();
        exitProcess(1);
        return;
    }
  } catch (error) {
    const formattedError = error instanceof Error ? formatErrorBox(error) : String(error);
    console.log();
    console.log(formattedError);
    console.log();

    if (!(error instanceof Error)) {
      handleError(new Error(String(error)));
    }

    exitProcess(1);
    throw error;
  }
}
