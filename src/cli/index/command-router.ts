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
import { routesCommand } from "../commands/routes.ts";
import { showLogo } from "../utils/index.ts";
import { handleBuildCommand } from "./build-handler.ts";
import { handleDevCommand } from "./dev-handler.ts";
import { handleGenerateCommand } from "./generate-handler.ts";
import { exitProcess } from "../utils/index.ts";
import type { ParsedArgs } from "./types.ts";
import type { CacheBackend, InitTemplate } from "../commands/init/types.ts";
import { cwd } from "../../platform/compat/process.ts";
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
    cliLogger.info(`Veryfront CLI v${VERSION}

Available commands:
  init          Create a new Veryfront project
  dev           Start the development server
  build         Build for production
  preview       Preview the production build
  doctor        Run diagnostic checks
  clean         Clean build and cache directories
  routes        List application routes
  generate      Generate new pages/components

Use 'veryfront <command> --help' for command-specific help.`);
  }
}

/**
 * Route and execute the appropriate CLI command
 *
 * @param args - Parsed CLI arguments
 */
export async function routeCommand(args: ParsedArgs): Promise<void> {
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
        const name = args._[1] as string | undefined;
        const template = (args.t || args.template) as InitTemplate | undefined;
        const cacheBackendArg = args["cache-backend"] ?? args.cacheBackend;
        await initCommand({
          name,
          template,
          appRouter: Boolean(args["app-router"]) || template === "app-router",
          cacheBackend: cacheBackendArg ? (String(cacheBackendArg) as CacheBackend) : undefined,
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
          const server = await startUniversalServer({
            projectDir,
            port,
            hostname,
            debug,
            adapter,
          });
          await server.ready;
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

      case "generate":
      case "g":
        showLogo();
        await handleGenerateCommand(args);
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
