/**
 * Command routing logic for CLI
 *
 * @module cli/router
 */

import { formatErrorBox } from "#veryfront/errors/user-friendly/index.ts";
import { cliLogger, VERSION } from "#veryfront/utils";
import { handleAnalyzeChunksCommand } from "./commands/analyze-chunks/handler.ts";
import { handleBuildCommand } from "./commands/build/handler.ts";
import { handleCleanCommand } from "./commands/clean/handler.ts";
import { handleDemoCommand } from "./commands/demo/handler.ts";
import { handleDeployCommand } from "./commands/deploy/handler.ts";
import { handleDevCommand } from "./commands/dev/handler.ts";
import { handleDoctorCommand } from "./commands/doctor/handler.ts";
import { handleGenerateCommand } from "./commands/generate/handler.ts";
import { handleInitCommand } from "./commands/init/handler.ts";
import { handleInstallCommand, handleUninstallCommand } from "./commands/install/handler.ts";
import { handleIssuesCommand } from "./commands/issues/index.ts";
import { handleLockCommand } from "./commands/lock/handler.ts";
import { handleMCPCommand } from "./commands/mcp/handler.ts";
import { handleMergeCommand } from "./commands/merge/handler.ts";
import { handleNewCommand } from "./commands/new/index.ts";
import { handlePullCommand } from "./commands/pull/index.ts";
import { handlePushCommand } from "./commands/push/index.ts";
import { handleRoutesCommand } from "./commands/routes/handler.ts";
import { handleServeCommand } from "./commands/serve/handler.ts";
import { handleStartCommand } from "./commands/start/handler.ts";
import { handleStudioCommand } from "./commands/studio/handler.ts";
import { handleUpCommand } from "./commands/up/index.ts";
import { login, logout, whoami } from "./auth/index.ts";
import { parseLoginMethod } from "./auth/utils.ts";
import { showCommandHelp, showMainHelp } from "./help/index.ts";
import { setColorOverride } from "./ui/colors.ts";
import { exitProcess, setQuietMode, setVerboseMode } from "./utils/index.ts";
import type { ParsedArgs } from "./shared/types.ts";

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
 * Route and execute the appropriate CLI command
 *
 * @param args - Parsed CLI arguments
 */
export async function routeCommand(args: ParsedArgs): Promise<void> {
  // Handle global flags
  if (args["no-color"]) setColorOverride(false);
  else if (args.color) setColorOverride(true);

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
        await handleBuildCommand(args);
        break;

      case "preview":
      case "serve":
        await handleServeCommand(args);
        break;

      case "doctor":
        await handleDoctorCommand(args);
        break;

      case "clean":
        await handleCleanCommand(args);
        break;

      case "analyze-chunks":
        await handleAnalyzeChunksCommand(args);
        break;

      case "routes":
        await handleRoutesCommand(args);
        break;

      case "studio":
        await handleStudioCommand(args);
        break;

      case "lock":
        await handleLockCommand(args);
        break;

      case "generate":
      case "g":
        await handleGenerateCommand(args);
        break;

      case "pull":
        await handlePullCommand(args);
        break;

      case "push":
        await handlePushCommand(args);
        break;

      case "merge":
        await handleMergeCommand(args);
        break;

      case "deploy":
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
        await handleInstallCommand(args);
        break;

      case "uninstall":
        await handleUninstallCommand(args);
        break;

      case "demo":
        await handleDemoCommand(args);
        break;

      case "mcp":
        await handleMCPCommand(args);
        break;

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
