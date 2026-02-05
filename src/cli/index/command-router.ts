/**
 * Command routing logic for CLI
 *
 * @module cli/index/command-router
 */

import { formatErrorBox } from "#veryfront/errors/user-friendly/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { cliLogger, VERSION } from "#veryfront/utils";
import { analyzeChunksCommand } from "../commands/analyze-chunks/index.ts";
import { cleanCommand } from "../commands/clean/index.ts";
import { doctorCommand } from "../commands/doctor/index.ts";
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
import { parseLoginMethod } from "../auth/utils.ts";
import { showCommandHelp, showMainHelp } from "../help/index.ts";
import {
  exitProcess,
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
import { handleInitCommand } from "../commands/init/handler.ts";
import { handleServeCommand } from "../commands/serve/handler.ts";
import type { ParsedArgs } from "./types.ts";

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

/**
 * Get string argument from multiple possible keys
 */
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
  // Handle global flags
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
      case "init":
        await handleInitCommand(args);
        break;

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
        await handleServeCommand(args);
        break;

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
