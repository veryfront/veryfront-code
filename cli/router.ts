/**
 * Command routing logic for CLI
 *
 * @module cli/router
 */

import { cliErrorBoundary } from "veryfront/errors";
import { cliLogger, VERSION } from "#cli/utils";
import { showCommandHelp, showMainHelp } from "./help/index.ts";
import { setColorOverride } from "./ui/colors.ts";
import { exitProcess, setQuietMode, setVerboseMode } from "./utils/index.ts";
import { ensureCliSchemaValidator } from "./shared/default-contracts.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  isJsonMode,
  outputJson,
  setJsonMode,
  setOutputPath,
} from "./shared/json-output.ts";
import { detectCI, setAutoConfirm, setNonInteractive } from "./shared/interactive.ts";
import type { ParsedArgs } from "./shared/types.ts";

type CommandHandler = (args: ParsedArgs) => Promise<void>;
type CommandLoader = () => Promise<CommandHandler>;

/**
 * Command registry mapping command names to their handlers.
 * Aliases (e.g. "preview" → serve, "g" → generate) are duplicate entries.
 */
const commands: Record<string, CommandLoader> = {
  "init": async () => (await import("./commands/init/handler.ts")).handleInitCommand,
  "dev": async () => (await import("./commands/dev/handler.ts")).handleDevCommand,
  "build": async () => (await import("./commands/build/handler.ts")).handleBuildCommand,
  "preview": async () => (await import("./commands/serve/handler.ts")).handleServeCommand,
  "serve": async () => (await import("./commands/serve/handler.ts")).handleServeCommand,
  "doctor": async () => (await import("./commands/doctor/handler.ts")).handleDoctorCommand,
  "clean": async () => (await import("./commands/clean/handler.ts")).handleCleanCommand,
  "analyze-chunks": async () =>
    (await import("./commands/analyze-chunks/handler.ts")).handleAnalyzeChunksCommand,
  "routes": async () => (await import("./commands/routes/handler.ts")).handleRoutesCommand,
  "studio": async () => (await import("./commands/studio/handler.ts")).handleStudioCommand,
  "styles": async () => (await import("./commands/styles/handler.ts")).handleStylesCommand,
  "lock": async () => (await import("./commands/lock/handler.ts")).handleLockCommand,
  "generate": async () => (await import("./commands/generate/handler.ts")).handleGenerateCommand,
  "g": async () => (await import("./commands/generate/handler.ts")).handleGenerateCommand,
  "pull": async () => (await import("./commands/pull/index.ts")).handlePullCommand,
  "push": async () => (await import("./commands/push/index.ts")).handlePushCommand,
  "uploads": async () => (await import("./commands/uploads/index.ts")).handleUploadsCommand,
  "files": async () => (await import("./commands/files/index.ts")).handleFilesCommand,
  "knowledge": async () => (await import("./commands/knowledge/index.ts")).handleKnowledgeCommand,
  "merge": async () => (await import("./commands/merge/handler.ts")).handleMergeCommand,
  "deploy": async () => (await import("./commands/deploy/handler.ts")).handleDeployCommand,
  "up": async () => (await import("./commands/up/index.ts")).handleUpCommand,
  "schedule": async () => (await import("./commands/schedule/handler.ts")).handleScheduleCommand,
  "schedules": async () => (await import("./commands/schedules/handler.ts")).handleSchedulesCommand,
  "login": async () => async (args) => {
    const { parseLoginMethod, parseProvider } = await import("./auth/utils.ts");
    const provider = parseProvider(args);
    if (provider === "anthropic") {
      const { loginAnthropic } = await import("./auth/providers/anthropic.ts");
      await loginAnthropic();
      return;
    }
    if (provider === "openai") {
      const { loginOpenAI } = await import("./auth/providers/openai.ts");
      await loginOpenAI(args["base-url"] as string | undefined);
      return;
    }
    const { login } = await import("./auth/index.ts");
    await login(parseLoginMethod(args));
  },
  "logout": async () => async (args) => {
    const { parseProvider } = await import("./auth/utils.ts");
    const provider = parseProvider(args);
    if (provider) {
      const { deleteProviderToken } = await import(
        "./auth/provider-store.ts"
      );
      await deleteProviderToken(provider);
      const { logSuccess } = await import("./utils/index.ts");
      logSuccess(`${provider} API key removed`);
      return;
    }
    const { logout } = await import("./auth/index.ts");
    await logout();
  },
  "whoami": async () => async () => {
    const { whoami } = await import("./auth/index.ts");
    await whoami();
  },
  "install": async () => (await import("./commands/install/handler.ts")).handleInstallCommand,
  "uninstall": async () => (await import("./commands/install/handler.ts")).handleUninstallCommand,
  "demo": async () => (await import("./commands/demo/handler.ts")).handleDemoCommand,
  "extension": async () => (await import("./commands/extension/handler.ts")).handleExtensionCommand,
  "mcp": async () => (await import("./commands/mcp/handler.ts")).handleMCPCommand,
  "issues": async () => (await import("./commands/issues/index.ts")).handleIssuesCommand,
  "start": async () => (await import("./commands/start/handler.ts")).handleStartCommand,
  "task": async () => (await import("./commands/task/handler.ts")).handleTaskCommand,
  "eval": async () => (await import("./commands/eval/handler.ts")).handleEvalCommand,
  "workflow": async () => (await import("./commands/workflow/handler.ts")).handleWorkflowCommand,
  "worker": async () => (await import("./commands/worker/handler.ts")).handleWorkerCommand,
  "schema": async () => (await import("./commands/schema/handler.ts")).handleSchemaCommand,
  "test": async () => (await import("./commands/test/handler.ts")).handleTestCommand,
  "lint": async () => (await import("./commands/lint/handler.ts")).handleLintCommand,
  "skills": async () => (await import("./commands/skills/handler.ts")).handleSkillsCommand,
  "config": async () => (await import("./commands/config/handler.ts")).handleConfigCommand,
  "open": async () => (await import("./commands/open/handler.ts")).handleOpenCommand,
  "completions": async () =>
    (await import("./commands/completions/handler.ts")).handleCompletionsCommand,
  "webhook": async () => (await import("./commands/webhook/handler.ts")).handleWebhookCommand,
  "webhooks": async () => (await import("./commands/webhooks/handler.ts")).handleWebhooksCommand,
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

function commandNameForJson(args: ParsedArgs): string {
  const command = args._[0];
  return typeof command === "string" && command.length > 0 ? command : "cli";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function outputCliJsonError(
  command: string,
  error: {
    code: string;
    slug: string;
    message: string;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  await outputJson(createErrorEnvelope(command, error));
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

  const autoConfirm = args.yes === true || args.y === true;
  setNonInteractive(autoConfirm || detectCI());
  setAutoConfirm(autoConfirm);

  if (args["no-animation"]) {
    const { setAnimationDisabled } = await import("./shared/animation.ts");
    setAnimationDisabled(true);
  }

  // Start update check early so the network request runs during command execution
  const updateCheck = import("./shared/update-check.ts")
    .then(({ checkForUpdates }) => checkForUpdates(VERSION))
    .catch(() => {});

  if (args.version || args.v) {
    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("version", {
        version: VERSION,
        deno: Deno.version.deno,
        v8: Deno.version.v8,
        typescript: Deno.version.typescript,
        os: Deno.build.os,
        arch: Deno.build.arch,
        standalone: Deno.build.standalone ?? false,
      }));
      exitProcess(0);
      return;
    }
    cliLogger.info(`Veryfront CLI v${VERSION}`);
    if (args.verbose) {
      cliLogger.info(
        `Deno ${Deno.version.deno} (V8 ${Deno.version.v8}, TypeScript ${Deno.version.typescript})`,
      );
      cliLogger.info(`OS: ${Deno.build.os} ${Deno.build.arch}`);
    }
    await updateCheck;
    exitProcess(0);
    return;
  }

  const command = args._[0] as string | undefined;

  if (args.help || args.h) {
    showHelp(command);
    await updateCheck;
    exitProcess(0);
    return;
  }

  if (command === "help") {
    const topic = args._[1];
    showHelp(typeof topic === "string" ? topic : undefined);
    await updateCheck;
    exitProcess(0);
    return;
  }

  const loader = command ? commands[command] : undefined;

  if (command && !loader) {
    const { suggestCommand } = await import("./shared/suggest.ts");
    const { COMMANDS } = await import("./help/command-definitions.ts");
    // Use canonical command names from help registry (excludes aliases like "g", "preview")
    const canonicalNames = Object.keys(COMMANDS);
    const suggestions = suggestCommand(command, canonicalNames);
    if (isJsonMode()) {
      await outputCliJsonError(command, {
        code: "USAGE_ERROR",
        slug: "unknown-command",
        message: `Unknown command: ${command}`,
        context: suggestions.length > 0 ? { suggestions } : {},
      });
      exitProcess(2);
      return;
    }
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

  await cliErrorBoundary(async () => {
    const handlerLoader = loader ?? commands.start;
    if (!handlerLoader) throw new Error("Start command is not registered");

    await ensureCliSchemaValidator();

    const handler = await handlerLoader();
    await handler(args);
  }, {
    onError: async (error) => {
      if (!isJsonMode()) {
        console.log((await import("veryfront/errors")).formatCLIError(error));
        return;
      }

      const message = errorMessage(error);
      const isUsageError = message.startsWith("Invalid ");
      await outputCliJsonError(commandNameForJson(args), {
        code: isUsageError ? "USAGE_ERROR" : "RUNTIME_ERROR",
        slug: isUsageError ? "invalid-arguments" : "command-failed",
        message,
      });
    },
    getExitCode: (error) => errorMessage(error).startsWith("Invalid ") ? 2 : 1,
  });

  // Wait for update check to finish (with timeout to avoid hanging)
  await Promise.race([
    updateCheck,
    new Promise((r) => setTimeout(r, 5000)),
  ]);
}
