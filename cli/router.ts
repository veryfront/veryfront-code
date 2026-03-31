/**
 * Command routing logic for CLI
 *
 * @module cli/router
 */

import { cliErrorBoundary } from "veryfront/errors";
import { cliLogger, VERSION } from "#cli/utils";
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
import { handlePullCommand } from "./commands/pull/index.ts";
import { handlePushCommand } from "./commands/push/index.ts";
import { handleUploadsCommand } from "./commands/uploads/index.ts";
import { handleFilesCommand } from "./commands/files/index.ts";
import { handleKnowledgeCommand } from "./commands/knowledge/index.ts";
import { handleRoutesCommand } from "./commands/routes/handler.ts";
import { handleServeCommand } from "./commands/serve/handler.ts";
import { handleStartCommand } from "./commands/start/handler.ts";
import { handleStudioCommand } from "./commands/studio/handler.ts";
import { handleStylesCommand } from "./commands/styles/handler.ts";
import { handleUpCommand } from "./commands/up/index.ts";
import { handleTaskCommand } from "./commands/task/handler.ts";
import { handleWorkflowCommand } from "./commands/workflow/handler.ts";
import { handleWorkerCommand } from "./commands/worker/handler.ts";
import { handleSchemaCommand } from "./commands/schema/handler.ts";
import { handleTestCommand } from "./commands/test/handler.ts";
import { handleLintCommand } from "./commands/lint/handler.ts";
import { handleSkillsCommand } from "./commands/skills/handler.ts";
import { handleCompletionsCommand } from "./commands/completions/handler.ts";
import { login, logout, whoami } from "./auth/index.ts";
import { parseLoginMethod } from "./auth/utils.ts";
import { showCommandHelp, showMainHelp } from "./help/index.ts";
import { setColorOverride } from "./ui/colors.ts";
import { exitProcess, setQuietMode, setVerboseMode } from "./utils/index.ts";
import { setJsonMode, setOutputPath } from "./shared/json-output.ts";
import { detectCI, setNonInteractive } from "./shared/interactive.ts";
import type { ParsedArgs } from "./shared/types.ts";

/**
 * Command registry mapping command names to their handlers.
 * Aliases (e.g. "preview" → serve, "g" → generate) are duplicate entries.
 */
const commands: Record<string, (args: ParsedArgs) => Promise<void>> = {
  "init": handleInitCommand,
  "dev": handleDevCommand,
  "build": handleBuildCommand,
  "preview": handleServeCommand,
  "serve": handleServeCommand,
  "doctor": handleDoctorCommand,
  "clean": handleCleanCommand,
  "analyze-chunks": handleAnalyzeChunksCommand,
  "routes": handleRoutesCommand,
  "studio": handleStudioCommand,
  "styles": handleStylesCommand,
  "lock": handleLockCommand,
  "generate": handleGenerateCommand,
  "g": handleGenerateCommand,
  "pull": handlePullCommand,
  "push": handlePushCommand,
  "uploads": handleUploadsCommand,
  "files": handleFilesCommand,
  "knowledge": handleKnowledgeCommand,
  "merge": handleMergeCommand,
  "deploy": handleDeployCommand,
  "up": handleUpCommand,
  "login": async (args) => {
    await login(parseLoginMethod(args));
  },
  "logout": async () => {
    await logout();
  },
  "whoami": async () => {
    await whoami();
  },
  "install": handleInstallCommand,
  "uninstall": handleUninstallCommand,
  "demo": handleDemoCommand,
  "mcp": handleMCPCommand,
  "issues": handleIssuesCommand,
  "start": handleStartCommand,
  "task": handleTaskCommand,
  "workflow": handleWorkflowCommand,
  "worker": handleWorkerCommand,
  "schema": handleSchemaCommand,
  "test": handleTestCommand,
  "lint": handleLintCommand,
  "skills": handleSkillsCommand,
  "completions": handleCompletionsCommand,
};

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

  if (args.json || args.j) setJsonMode(true);
  if (typeof args.output === "string") setOutputPath(args.output);
  else if (typeof args.o === "string") setOutputPath(args.o as string);

  if (args.yes || args.y || detectCI()) setNonInteractive(true);

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

  await cliErrorBoundary(async () => {
    if (command === "help") {
      showHelp();
      exitProcess(0);
      return;
    }

    const handler = command ? commands[command] : undefined;

    if (command && !handler) {
      const { suggestCommand } = await import("./shared/suggest.ts");
      const { COMMANDS } = await import("./help/command-definitions.ts");
      // Use canonical command names from help registry (excludes aliases like "g", "preview")
      const canonicalNames = Object.keys(COMMANDS);
      const suggestions = suggestCommand(command, canonicalNames);
      cliLogger.error(`Unknown command: ${command}\n`);
      if (suggestions.length > 0) {
        cliLogger.info(`  Did you mean?`);
        for (const s of suggestions) {
          const desc = COMMANDS[s]?.description ?? "";
          cliLogger.info(`    ${s}    ${desc}`);
        }
      } else {
        showHelp();
      }
      exitProcess(1);
      return;
    }

    await (handler ?? handleStartCommand)(args);
  });
}
