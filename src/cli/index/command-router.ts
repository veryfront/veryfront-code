/**
 * Command routing logic for CLI
 *
 * @module cli/index/command-router
 */

import { VERSION } from "@veryfront/utils";
import { handleError } from "@veryfront/errors";
import { formatUserError } from "@veryfront/errors/user-friendly/index.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "@veryfront/utils";
import { analyzeChunksCommand } from "../commands/analyze-chunks.ts";
import { cleanCommand } from "../commands/clean.ts";
import { doctorCommand } from "../commands/doctor/index.ts";
import { initCommand } from "../commands/init/index.ts";
import { lockCommand } from "../commands/lock.ts";
import { routesCommand } from "../commands/routes.ts";
import { pullCommand } from "../commands/pull.ts";
import { pushCommand } from "../commands/push.ts";
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
import type { ParsedArgs } from "./types.ts";
import type { InitTemplate } from "../commands/init/types.ts";
import type { IntegrationName } from "../templates/types.ts";
import { cwd } from "../../platform/compat/process.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { join } from "../../platform/compat/path/index.ts";
import { COMMANDS } from "../help/command-definitions.ts";
import {
  calculateMaxLength,
  formatCommandHeader,
  formatExample,
  formatOption,
  formatSectionHeader,
  formatUsage,
} from "../help/formatters.ts";
import { dim } from "@veryfront/compat/console";

/**
 * Show basic help information
 */
function showBasicHelp(command?: string): void {
  if (command && COMMANDS[command]) {
    const cmd = COMMANDS[command];

    // Header
    cliLogger.info(formatCommandHeader(cmd.name));
    cliLogger.info(`${cmd.description}\n`);

    // Usage
    cliLogger.info(formatUsage(cmd.usage));

    // Options
    if (cmd.options && cmd.options.length > 0) {
      cliLogger.info(`\n${formatSectionHeader("Options")}`);
      const maxFlagLength = calculateMaxLength(cmd.options.map((o) => ({ length: o.flag.length })));
      for (const option of cmd.options) {
        cliLogger.info(formatOption(option, maxFlagLength));
      }
    }

    // Examples
    if (cmd.examples && cmd.examples.length > 0) {
      cliLogger.info(`\n${formatSectionHeader("Examples")}`);
      for (const example of cmd.examples) {
        cliLogger.info(formatExample(example));
      }
    }

    // Notes
    if (cmd.notes && cmd.notes.length > 0) {
      cliLogger.info(`\n${formatSectionHeader("Notes")}`);
      for (const note of cmd.notes) {
        cliLogger.info(`  ${dim("-")} ${note}`);
      }
    }

    cliLogger.info("");
  } else if (command) {
    cliLogger.info(`Unknown command: ${command}`);
    cliLogger.info(`Use 'veryfront --help' to see available commands.`);
  } else {
    // Dynamically generate command list from COMMANDS registry
    const maxLen = Math.max(...Object.values(COMMANDS).map((c) => c.name.length)) + 2;
    const commandList = Object.values(COMMANDS)
      .map((cmd) => `  ${cmd.name.padEnd(maxLen)}${cmd.description}`)
      .join("\n");
    cliLogger.info(`Veryfront CLI v${VERSION}

Available commands:
${commandList}

Use 'veryfront <command> --help' for command-specific help.`);
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
    showBasicHelp(command);
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
          const { startUniversalServer } = await import("../../server/production-server.ts");

          const projectDir = cwd();
          const port = args.port ?? DEFAULT_DEV_SERVER_PORT;
          const hostname = String(args.hostname || args.host || "0.0.0.0");
          const debug = Boolean(args.debug);
          const shutdownController = new AbortController();
          const server = await startUniversalServer({
            projectDir,
            port,
            hostname,
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
          // Resolve directory: --dir/-d option, or current working directory
          const dirArg = args.dir ? String(args.dir) : args.d ? String(args.d) : undefined;
          const projectDir = dirArg
            ? (dirArg.startsWith("/") ? dirArg : join(cwd(), dirArg))
            : cwd();
          await pullCommand({
            projectDir,
            branch: args.branch ? String(args.branch) : args.b ? String(args.b) : undefined,
            types: args.types ? String(args.types).split(",") : undefined,
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
            types: args.types ? String(args.types).split(",") : undefined,
            force: Boolean(args.force) || Boolean(args.f),
            dryRun: Boolean(args["dry-run"]),
          });
        }
        break;

      case "help":
        showBasicHelp();
        exitProcess(0);
        return;

      case undefined:
        showBasicHelp();
        exitProcess(0);
        return;

      default:
        cliLogger.error(`Unknown command: ${command}\n`);
        showBasicHelp();
        exitProcess(1);
        return;
    }
  } catch (error) {
    const formattedError = error instanceof Error ? formatUserError(error) : String(error);
    cliLogger.error(formattedError);
    if (!(error instanceof Error)) {
      handleError(new Error(String(error)));
    }
    exitProcess(1);
    throw error;
  }
}
