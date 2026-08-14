/**
 * Command routing logic for CLI
 *
 * @module cli/router
 */

import { cliErrorBoundary } from "veryfront/errors";
import { cliLogger, isVerbose, VERSION } from "#cli/utils";
import { showCommandHelp, showMainHelp } from "./help/index.ts";
import { setColorOverride, shouldUseColor } from "./ui/colors.ts";
import { exitProcess, setQuietMode, setVerboseMode } from "./utils/index.ts";
import { ensureCliSchemaValidator } from "./shared/default-contracts.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  type ErrorEnvelope,
  isJsonMode,
  outputJson,
  setJsonMode,
  setOutputPath,
} from "./shared/json-output.ts";
import { detectCI, setAutoConfirm, setNonInteractive } from "./shared/interactive.ts";
import { isCliOptionValue } from "./shared/args.ts";
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
  "project": async () => (await import("./commands/project/index.ts")).handleProjectCommand,
  "projects": async () => (await import("./commands/project/index.ts")).handleProjectCommand,
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
    // Every branch reports failure the same way: exit non-zero so scripts can
    // tell a failed login from a successful one, whichever credential was asked for.
    if (provider === "anthropic") {
      const { loginAnthropic } = await import("./auth/providers/anthropic.ts");
      if (!await loginAnthropic()) exitProcess(1);
      return;
    }
    if (provider === "openai") {
      const { loginOpenAI } = await import("./auth/providers/openai.ts");
      if (!await loginOpenAI(args["base-url"] as string | undefined)) exitProcess(1);
      return;
    }
    const { login } = await import("./auth/index.ts");
    if (!await login(parseLoginMethod(args))) exitProcess(1);
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
    // The exit code is the machine-readable answer: 0 authenticated, 1 not.
    if (!await whoami()) exitProcess(1);
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
function showHelp(command?: string, showAll = false): void {
  if (command) {
    showCommandHelp(command);
    return;
  }
  showMainHelp(showAll);
}

function commandNameForJson(args: ParsedArgs): string {
  const command = args._[0];
  return typeof command === "string" && command.length > 0 ? command : "cli";
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
const LOCAL_PATH_BOUNDARIES = new Set(["=", ":", ",", " ", "\t", "\n", "\r", "'", '"']);

function startsWithLocalPath(value: string): boolean {
  return /^file:/iu.test(value) ||
    /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(value);
}

function containsLocalPath(value: string): boolean {
  if (startsWithLocalPath(value)) return true;

  for (let index = 0; index < value.length; index++) {
    const separator = value[index]!;
    if (!LOCAL_PATH_BOUNDARIES.has(separator)) continue;

    const suffix = value.slice(index + 1);
    if (!startsWithLocalPath(suffix)) continue;
    if (separator !== ":" || !suffix.startsWith("//")) return true;

    let previousSeparator = index - 1;
    while (
      previousSeparator >= 0 &&
      !LOCAL_PATH_BOUNDARIES.has(value[previousSeparator]!)
    ) previousSeparator--;
    if (!URL_SCHEME.test(value.slice(previousSeparator + 1, index))) return true;
  }

  return false;
}

function formatCommandHintArgument(
  value: string | number,
  sanitize: (input: string) => string,
  options: { allowRootRelativeRoute?: boolean } = {},
): string {
  const argument = String(value);
  const isAllowedRootRelativeRoute = options.allowRootRelativeRoute &&
    argument.startsWith("/");
  if (
    argument.length > 256 ||
    containsControlCharacter(argument) ||
    (containsLocalPath(argument) && !isAllowedRootRelativeRoute)
  ) {
    return "'<REDACTED>'";
  }
  const sanitized = sanitize(argument);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(sanitized)) {
    return sanitized;
  }
  return `'${sanitized.replaceAll("'", "'\\''")}'`;
}

export async function formatDuplicatedBinaryHint(
  args: ParsedArgs,
  os = Deno.build.os,
): Promise<string | undefined> {
  if (os === "windows") {
    return undefined;
  }
  const { sanitizeUrlCredentials } = await import("veryfront/utils");
  const { COMMANDS } = await import("./help/command-definitions.ts");
  const duplicatedBinaryIndex = args.__rawPositionals?.[0];
  const correctedCommand = args._[1];
  const canonicalCommand = typeof correctedCommand === "string"
    ? Object.values(COMMANDS).find((definition) =>
      definition.name === correctedCommand || definition.aliases?.includes(correctedCommand)
    )?.name ?? correctedCommand
    : undefined;
  const hintArguments = args.__raw !== undefined && duplicatedBinaryIndex !== undefined
    ? args.__raw.filter((_, index) => index !== duplicatedBinaryIndex)
    : args._.slice(1).map(String);
  const positionalIssueTitle = correctedCommand === "issues" && args._[2] === "create" &&
    typeof args._[3] === "string" && !args._[3].startsWith("-");
  const positionalIssueTitleRawIndex = positionalIssueTitle
    ? args.__rawPositionals?.[3]
    : undefined;
  const positionalIssueTitleHintIndex = positionalIssueTitleRawIndex !== undefined &&
      duplicatedBinaryIndex !== undefined
    ? positionalIssueTitleRawIndex - (duplicatedBinaryIndex < positionalIssueTitleRawIndex ? 1 : 0)
    : positionalIssueTitle
    ? 2
    : undefined;
  const positionalPullProject = correctedCommand === "pull" &&
    typeof args._[2] === "string" && !args._[2].startsWith("-");
  const positionalPullProjectRawIndex = positionalPullProject
    ? args.__rawPositionals?.[2]
    : undefined;
  const positionalPullProjectHintIndex = positionalPullProjectRawIndex !== undefined &&
      duplicatedBinaryIndex !== undefined
    ? positionalPullProjectRawIndex -
      (duplicatedBinaryIndex < positionalPullProjectRawIndex ? 1 : 0)
    : positionalPullProject
    ? 1
    : undefined;
  const formatted: string[] = [];
  const opaquePayloadOptions = new Set(["--config", "--input"]);
  const opaqueIssueOptions = new Set([
    "--assignee",
    "--assignees",
    "-a",
    "--body",
    "-b",
    "--labels",
    "-l",
    "--title",
    "-t",
  ]);
  const opaqueRemoteTargetOptions = new Set([
    "--project",
    "-p",
    "--projects",
    "--environment",
    "--env",
    "-e",
    "--branch",
    "-b",
    "--release",
    "--release-name",
  ]);
  const opaqueWorkerConnectionOptions = new Set(["--redis", "--redis-url"]);
  const opaqueServeHostOptions = new Set(["--host", "--hostname"]);
  const opaqueRemoteTargetCommands = new Set([
    "deploy",
    "files",
    "knowledge",
    "open",
    "pull",
    "push",
    "uploads",
  ]);
  const knownUndocumentedLoginOptions = new Set(["--provider"]);
  const rootRelativeRouteOptions = new Set(["--exclude", "--include"]);
  const globalBooleanOptions = new Set([
    "--color",
    "-h",
    "--help",
    "-j",
    "--json",
    "--no-animation",
    "--no-color",
    "--no-input",
    "-q",
    "--quiet",
    "-v",
    "--verbose",
    "--version",
    "-y",
    "--yes",
  ]);
  const globalValueOptions = new Set(["-o", "--output"]);
  const commandOptions = canonicalCommand !== undefined
    ? COMMANDS[canonicalCommand]?.options ?? []
    : [];
  let optionsEnded = false;

  for (let index = 0; index < hintArguments.length; index++) {
    const argument = hintArguments[index]!;
    if (
      index === positionalIssueTitleHintIndex || index === positionalPullProjectHintIndex
    ) {
      formatted.push("'<REDACTED>'");
      continue;
    }
    if (argument === "--") {
      formatted.push(argument);
      optionsEnded = true;
      continue;
    }
    if (optionsEnded) {
      formatted.push(formatCommandHintArgument(argument, sanitizeUrlCredentials));
      continue;
    }
    const equalsIndex = argument.startsWith("-") ? argument.indexOf("=") : -1;
    const option = equalsIndex > 0 ? argument.slice(0, equalsIndex) : argument;
    const optionDefinition = commandOptions.find((definition) =>
      (definition.flag.match(/--?[a-z0-9-]+/giu) ?? []).some((name) => name === option)
    );
    const sensitiveOption = /^--?(?:.*-)?(?:auth|credential|key|password|secret|token)$/iu.test(
      option,
    );
    const fileOption = optionDefinition?.flag.includes("<file>") === true;
    const opaqueIssueOption = correctedCommand === "issues" && opaqueIssueOptions.has(option);
    const opaqueRemoteTargetOption = canonicalCommand !== undefined &&
      opaqueRemoteTargetCommands.has(canonicalCommand) &&
      opaqueRemoteTargetOptions.has(option);
    const opaqueConnectionOption = (correctedCommand === "worker" &&
      opaqueWorkerConnectionOptions.has(option)) ||
      (correctedCommand === "login" && option === "--base-url") ||
      (canonicalCommand === "serve" &&
        opaqueServeHostOptions.has(option));
    const knownGlobalOption = globalBooleanOptions.has(option) || globalValueOptions.has(option);
    const knownUndocumentedOption = correctedCommand === "login" &&
      knownUndocumentedLoginOptions.has(option);
    const unknownOption = option.startsWith("-") && optionDefinition === undefined &&
      !knownUndocumentedOption &&
      !knownGlobalOption;
    const redactOptionValue = sensitiveOption || opaqueIssueOption || opaqueRemoteTargetOption ||
      opaqueConnectionOption ||
      (opaquePayloadOptions.has(option) && !fileOption) || unknownOption;
    const allowRootRelativeRoute = canonicalCommand === "build" &&
      rootRelativeRouteOptions.has(option);
    const booleanOption = globalBooleanOptions.has(option) ||
      (optionDefinition !== undefined && !optionDefinition.flag.includes("<"));
    const nextArgument = hintArguments[index + 1];
    const hasSeparateRawValue = isCliOptionValue(nextArgument);

    if (equalsIndex > 0) {
      const formattedOption = formatCommandHintArgument(option, sanitizeUrlCredentials);
      const rawValue = argument.slice(equalsIndex + 1);
      const explicitBooleanValue = booleanOption &&
        /^(?:false|no|off|0|true|yes|on|1)$/iu.test(rawValue.trim());
      const value = explicitBooleanValue
        ? formatCommandHintArgument(rawValue, sanitizeUrlCredentials)
        : redactOptionValue
        ? "'<REDACTED>'"
        : formatCommandHintArgument(rawValue, sanitizeUrlCredentials, {
          allowRootRelativeRoute,
        });
      formatted.push(`${formattedOption}=${value}`);
      continue;
    }

    formatted.push(formatCommandHintArgument(argument, sanitizeUrlCredentials));
    if (
      redactOptionValue &&
      hasSeparateRawValue
    ) {
      formatted.push("'<REDACTED>'");
      index++;
    } else if (
      allowRootRelativeRoute &&
      hasSeparateRawValue
    ) {
      formatted.push(formatCommandHintArgument(
        nextArgument,
        sanitizeUrlCredentials,
        { allowRootRelativeRoute: true },
      ));
      index++;
    }
  }

  return ["veryfront", ...formatted].join(" ");
}

async function outputCliJsonError(
  command: string,
  error: ErrorEnvelope["error"],
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
  setNonInteractive(args["no-input"] === true || autoConfirm || detectCI());
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
  const secondCommand = args._[1];
  const duplicatedBinaryTarget = command === "veryfront" &&
      typeof secondCommand === "string" &&
      (secondCommand === "help" || Object.hasOwn(commands, secondCommand))
    ? secondCommand
    : undefined;

  if ((args.help || args.h) && !duplicatedBinaryTarget) {
    showHelp(command, args.all === true);
    await updateCheck;
    exitProcess(0);
    return;
  }

  if (command === "help") {
    const topic = args._[1];
    showHelp(typeof topic === "string" ? topic : undefined, args.all === true);
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
    const suggestions = duplicatedBinaryTarget
      ? [duplicatedBinaryTarget]
      : suggestCommand(command, canonicalNames);
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
    if (duplicatedBinaryTarget) {
      const correctedCommand = await formatDuplicatedBinaryHint(args);
      if (correctedCommand === undefined) {
        cliLogger.info(
          '  You already included "veryfront". Remove the extra "veryfront" argument and run the command again.',
        );
      } else {
        cliLogger.info('  You already included "veryfront". Use:');
        cliLogger.info(`    ${correctedCommand}`);
      }
    } else if (suggestions.length > 0) {
      cliLogger.info(`  Did you mean?`);
      for (const s of suggestions) {
        const desc = COMMANDS[s]?.description ?? "";
        cliLogger.info(`    ${s}    ${desc}`);
      }
    } else {
      showHelp();
    }
    exitProcess(2);
    return;
  }

  await cliErrorBoundary(async () => {
    const handlerLoader = loader ?? commands.start;
    if (!handlerLoader) throw new Error("Start command is not registered");

    await ensureCliSchemaValidator();

    const handler = await handlerLoader();
    await handler(args);
  }, {
    onError: async (_error, vfError) => {
      if (!isJsonMode()) {
        console.error((await import("veryfront/errors")).formatCLIError(vfError, {
          color: shouldUseColor(),
          verbose: isVerbose(),
        }));
        return;
      }

      const message = vfError.detail ?? vfError.message;
      const isUsageError = vfError.exitCode === 2 || message.startsWith("Invalid ");
      await outputCliJsonError(commandNameForJson(args), {
        code: isUsageError ? "USAGE_ERROR" : "RUNTIME_ERROR",
        slug: isUsageError ? "invalid-arguments" : "command-failed",
        registrySlug: vfError.slug,
        message: vfError.detail ?? message,
      });
    },
    getExitCode: (_error, vfError) =>
      vfError.exitCode ?? ((vfError.detail ?? vfError.message).startsWith("Invalid ") ? 2 : 1),
  });

  // Wait for update check to finish (with timeout to avoid hanging)
  await Promise.race([
    updateCheck,
    new Promise((r) => setTimeout(r, 5000)),
  ]);
}
