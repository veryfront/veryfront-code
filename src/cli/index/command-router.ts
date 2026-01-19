/**
 * Command routing logic for CLI
 *
 * @module cli/index/command-router
 */

import { handleError } from "@veryfront/errors";
import { formatErrorBox } from "@veryfront/errors/user-friendly/index.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT, VERSION } from "@veryfront/utils";
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
import { promptProjectName, showMainMenu } from "../commands/main.ts";
import { login, logout, whoami } from "../auth/index.ts";
import { COMMANDS } from "../help/command-definitions.ts";
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
import type { ParsedArgs } from "./types.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import type { IntegrationName } from "../templates/types.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { showCommandHelp, showMainHelp } from "../help/index.ts";
import { createMCPServer } from "../mcp/server.ts";

/**
 * Handle validation errors using central COMMANDS registry for usage
 */
function handleValidationError(error: z.ZodError, commandName: string): void {
  const issues = error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  cliLogger.error(`Invalid ${commandName} arguments:\n${issues}`);

  // Get usage from central COMMANDS registry
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
  } else {
    showMainHelp();
  }
}

/**
 * Route and execute the appropriate CLI command
 *
 * @param args - Parsed CLI arguments
 */
export async function routeCommand(args: ParsedArgs): Promise<void> {
  // Initialize global CLI modes (clig.dev compliance)
  // Color mode: --no-color disables, --color forces, NO_COLOR env also respected
  if (args["no-color"]) {
    setColorMode(false);
  } else if (args.color) {
    setColorMode(true);
  }

  // Verbose/Quiet mode
  if (args.verbose) {
    setVerboseMode(true);
  } else if (args.quiet || args.q) {
    setQuietMode(true);
  }

  // Handle version flag
  if (args.version || args.v) {
    cliLogger.info(`Veryfront CLI v${VERSION}`);
    exitProcess(0);
    return;
  }

  const command = args._[0] as string;

  // Handle help flag
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

        // Support --config flag for JSON-based configuration
        const configPath = args.config || args.c;
        if (configPath) {
          const fs = createFileSystem();
          const resolvedPath = String(configPath).startsWith("/")
            ? String(configPath)
            : join(cwd(), String(configPath));

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

            // Config file values (can be overridden by CLI flags)
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

        // Parse integrations from --integrations flag (comma-separated)
        // This overrides config file if provided
        if (args.integrations) {
          const integrationsArg = String(args.integrations);
          integrations = integrationsArg.split(",").map((s) => s.trim()) as IntegrationName[];
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
      case "serve":
        showLogo();
        {
          const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
          const adapter = await getAdapter();
          const { startUniversalServer } = await import("@veryfront/server/production-server.ts");

          const projectDir = cwd();
          const port = args.port ?? DEFAULT_DEV_SERVER_PORT;
          const bindAddress = String(args.hostname || args.host || "0.0.0.0");
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

          // Graceful shutdown for preview/serve mode
          let shuttingDown = false;
          const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
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

          // Keep process alive until Ctrl+C
          await new Promise(() => {
            /* never resolve */
          });
        }
        break;

      case "doctor":
        showLogo();
        await doctorCommand(cwd(), {
          strict: Boolean(args.strict) || Boolean(args.s),
        });
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
        await routesCommand(cwd(), {
          json: Boolean(args.json) || Boolean(args.j),
        });
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

      case "pull":
        showLogo();
        {
          // Get project slug from positional argument (e.g., `pull my-project`)
          const projectSlug = args._.length > 1 ? String(args._[1]) : undefined;
          // Parse --projects flag (comma-separated list)
          const projectsArg = args.projects ? String(args.projects) : undefined;
          const projects = projectsArg
            ? projectsArg.split(",").map((p) => p.trim()).filter(Boolean)
            : undefined;
          // Resolve directory: --project-dir/--dir/-d option, or current working directory
          const dirArg = args["project-dir"]
            ? String(args["project-dir"])
            : args.dir
            ? String(args.dir)
            : args.d
            ? String(args.d)
            : undefined;
          const projectDir = dirArg
            ? (dirArg.startsWith("/") ? dirArg : join(cwd(), dirArg))
            : cwd();
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
        }
        break;

      case "push":
        showLogo();
        {
          // Resolve directory: --dir/-d option, or current working directory
          const dirArg = args.dir ? String(args.dir) : args.d ? String(args.d) : undefined;
          const projectDir = dirArg
            ? (dirArg.startsWith("/") ? dirArg : join(cwd(), dirArg))
            : cwd();
          await pushCommand({
            projectDir,
            branch: args.branch ? String(args.branch) : args.b ? String(args.b) : undefined,
            force: Boolean(args.force) || Boolean(args.f),
            dryRun: Boolean(args["dry-run"]),
          });
        }
        break;

      case "merge":
        showLogo();
        {
          const result = parseMergeArgs(args);
          if (!result.success) {
            handleValidationError(result.error, "merge");
            exitProcess(1);
            return;
          }
          await mergeCommand(result.data);
        }
        break;

      case "deploy":
        showLogo();
        {
          const result = parseDeployArgs(args);
          if (!result.success) {
            handleValidationError(result.error, "deploy");
            exitProcess(1);
            return;
          }
          await deployCommand(result.data);
        }
        break;

      case "up":
        // The main unified command
        {
          const result = parseUpArgs(args);
          if (!result.success) {
            handleValidationError(result.error, "up");
            exitProcess(1);
            return;
          }
          await upCommand(result.data);
        }
        break;

      case "new":
        // Lightning-fast project creation for pro coders
        {
          let name = args._[1] as string;
          if (!name) {
            // Prompt for name interactively (returns null in non-TTY or on Ctrl+C)
            const prompted = await promptProjectName();
            if (prompted) {
              name = prompted;
            } else {
              // Non-TTY or user cancelled
              exitProcess(0);
              return;
            }
          }
          const result = parseNewArgs(args);
          if (!result.success) {
            handleValidationError(result.error, "new");
            exitProcess(1);
            return;
          }
          await newCommand(name, result.data);
        }
        break;

      case "login":
        // Explicit login command
        {
          const method = args.google
            ? "google"
            : args.github
            ? "github"
            : args.microsoft
            ? "microsoft"
            : args.token
            ? "token"
            : undefined;
          await login(method as "google" | "github" | "microsoft" | "token" | undefined);
        }
        break;

      case "logout":
        // Clear stored credentials
        await logout();
        break;

      case "whoami":
        // Show current user
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

      case "demo":
        {
          const { demoCommand } = await import("../commands/demo/index.ts");
          await demoCommand({
            projectName: args._[1] ? String(args._[1]) : undefined,
            auto: Boolean(args.auto),
            loginMethod: args.login
              ? String(args.login) as "google" | "github" | "microsoft" | "token"
              : undefined,
          });
        }
        break;

      case "mcp":
        // MCP server for coding agents (stdio transport)
        {
          const server = await createMCPServer({ stdio: true });
          // Keep process alive - MCP server handles stdin/stdout
          await new Promise(() => {
            /* never resolve - stdio loop runs until stdin closes */
          });
          await server.stop();
        }
        break;

      case "help":
        showHelp();
        exitProcess(0);
        return;

      case undefined:
        // Interactive main menu
        {
          const action = await showMainMenu();

          switch (action) {
            case "new": {
              // Prompt for project name
              const name = await promptProjectName();
              if (name) {
                await newCommand(name, {});
              }
              break;
            }
            case "dev":
              await handleDevCommand(args);
              break;
            case "deploy": {
              const result = parseDeployArgs(args);
              if (result.success) {
                await deployCommand(result.data);
              }
              break;
            }
            case "login":
              await login();
              break;
            case "help":
              showHelp();
              break;
            case "exit":
            case null:
              exitProcess(0);
              break;
          }
        }
        break;

      default:
        cliLogger.error(`Unknown command: ${command}\n`);
        showHelp();
        exitProcess(1);
        return;
    }
  } catch (error) {
    // Display polished error box
    const formattedError = error instanceof Error ? formatErrorBox(error) : String(error);
    console.log(); // Add spacing
    console.log(formattedError);
    console.log();
    if (!(error instanceof Error)) {
      handleError(new Error(String(error)));
    }
    exitProcess(1);
    throw error;
  }
}
