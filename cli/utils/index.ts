import denoConfig from "../../deno.json" with { type: "json" };
import { exit, onSignal } from "#cli/process-lifecycle";
import { INVALID_ARGUMENT } from "veryfront/errors";
import {
  getEnv,
  isStdoutTTY,
  promptSync,
  readStdinByteSync,
  readStdinLine,
  setRawMode,
  writeStdout,
} from "veryfront/platform";
import { isTruthyEnvValue } from "veryfront/utils";
import { DEFAULT_DEV_PORT } from "../shared/constants.ts";
import { bold, brand, dim, error as errorColor, warning as warningColor } from "../ui/colors.ts";
import { isJsonMode } from "../shared/json-output.ts";
import {
  refreshLoggerConfig as _refreshCanonicalLoggerConfig,
  setLogLevel as _setCanonicalLogLevel,
} from "#cli/logger-config";
import { cliLogger as _canonicalCliLogger, LogLevel } from "veryfront/utils/logger";

type LoggerMethod = (...args: unknown[]) => void;

function debugEnabled(): boolean {
  return _verboseMode || isTruthyEnvValue(getEnv("VERYFRONT_DEBUG"));
}

function firstAsString(args: unknown[]): string {
  const [first] = args;
  return typeof first === "string" ? first : String(first);
}

export const cliLogger: {
  debug: LoggerMethod;
  info: LoggerMethod;
  warn: LoggerMethod;
  error: LoggerMethod;
  child: (_context: Record<string, unknown>) => typeof cliLogger;
  component: (_name: string) => typeof cliLogger;
} = {
  debug: (...args) => {
    if (isJsonMode() || !debugEnabled()) return;
    _canonicalCliLogger.debug(firstAsString(args), ...args.slice(1));
  },
  info: (...args) => _canonicalCliLogger.info(firstAsString(args), ...args.slice(1)),
  warn: (...args) => _canonicalCliLogger.warn(firstAsString(args), ...args.slice(1)),
  error: (...args) => _canonicalCliLogger.error(firstAsString(args), ...args.slice(1)),
  child: () => cliLogger,
  // CLI logger ignores component names — no structured tag in CLI output.
  component: () => cliLogger,
};

export const VERSION = typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0";
export const DEFAULT_DEV_SERVER_PORT = DEFAULT_DEV_PORT;

export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);

  const formatNumber = (value: number): string => {
    const rounded = Math.round(value * 100) / 100;
    if (Number.isInteger(rounded)) return String(Math.trunc(rounded));
    return String(rounded);
  };

  if (abs < 1024) return `${formatNumber(abs)} Bytes`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = abs / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${formatNumber(value)} ${units[unitIndex]}`;
}

export function isTTY(): boolean {
  return isStdoutTTY();
}

export function showHeader(): void {
  if (isJsonMode()) return;

  // Raw brand output is written directly to stdout, not through the canonical
  // logger, so it never picks up a timestamp/tag/glyph prefix.
  console.log(`${bold(brand("Veryfront"))} ${dim(`(v${VERSION})`)}`);
  console.log();
}

/** @deprecated Use {@link showHeader}. */
export const showLogo = showHeader;

export function logSuccess(message: string): void {
  console.log(`  ✓ ${message}`);
}

export function logError(message: string): void {
  console.error(`  ${errorColor("✗")} ${message}`);
}

export function logWarning(message: string): void {
  console.warn(`  ${warningColor("!")} ${message}`);
}

export function logUsageError(message: string, hint?: string): void {
  logError(message);
  if (hint) {
    console.error(`  ${dim(hint)}`);
  }
}

export function logInfo(message: string): void {
  console.log(`  ${dim("›")} ${message}`);
}

export function registerTerminationSignals(
  handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>,
): void {
  const signals: Array<"SIGINT" | "SIGTERM"> = ["SIGINT", "SIGTERM"];

  for (const signal of signals) {
    onSignal(signal, () => {
      try {
        const result = handler(signal);
        if (result && typeof (result as PromiseLike<void>).then === "function") {
          void Promise.resolve(result).catch((error) => {
            cliLogger.error(`Unhandled error while handling ${signal}:`, error);
            exitProcess(1);
          });
        }
      } catch (error) {
        cliLogger.error(`Unhandled error while handling ${signal}:`, error);
        exitProcess(1);
      }
    });
  }
}

let _verboseMode = false;
let _quietMode = false;

function syncCanonicalLogLevel(): void {
  if (_verboseMode) {
    _setCanonicalLogLevel(LogLevel.DEBUG);
  } else if (_quietMode) {
    _setCanonicalLogLevel(LogLevel.WARN);
  } else {
    _refreshCanonicalLoggerConfig();
  }
}

export function setVerboseMode(enabled: boolean): void {
  _verboseMode = enabled;
  if (enabled) _quietMode = false;
  syncCanonicalLogLevel();
}

export function setQuietMode(enabled: boolean): void {
  _quietMode = enabled;
  if (enabled) _verboseMode = false;
  syncCanonicalLogLevel();
}

export function isVerbose(): boolean {
  return _verboseMode;
}

export function isQuiet(): boolean {
  return _quietMode;
}

export async function promptUser(message: string): Promise<string> {
  const { isInteractive } = await import("../shared/interactive.ts");
  if (!isInteractive()) {
    throw INVALID_ARGUMENT.create({
      detail: "Interactive input is disabled. Pass the required value as a flag or argument.",
    });
  }

  if (typeof globalThis.prompt === "function") {
    return promptSync(message)?.trim() ?? "";
  }

  writeStdout(message);
  return (await readStdinLine())?.trim() ?? "";
}

const CTRL_C = 0x03;
const BACKSPACE = 0x7f;
const ENTER_CR = 0x0d;
const ENTER_LF = 0x0a;

/**
 * Prompts for a value with hidden input (shows * for each character).
 * Uses synchronous byte-by-byte reading to avoid conflicts with globalThis.prompt.
 */
export function promptPassword(message: string): string {
  writeStdout(message);
  setRawMode(true);

  const chars: string[] = [];

  try {
    while (true) {
      const byte = readStdinByteSync();
      if (byte === null) break;

      if (byte === CTRL_C) {
        writeStdout("\n");
        exit(130);
      }

      if (byte === ENTER_CR || byte === ENTER_LF) {
        writeStdout("\n");
        break;
      }

      if (byte === BACKSPACE) {
        if (chars.length > 0) {
          chars.pop();
          writeStdout("\b \b");
        }
        continue;
      }

      if (byte >= 0x20 && byte < 0x7f) {
        chars.push(String.fromCharCode(byte));
        writeStdout("*");
      }
    }
  } finally {
    setRawMode(false);
  }

  return chars.join("");
}

export async function confirmPrompt(
  message: string,
  defaultValue = false,
): Promise<boolean> {
  const { isAutoConfirmEnabled, isInteractive } = await import("../shared/interactive.ts");
  const interactive = isInteractive();
  if (!interactive) {
    if (isAutoConfirmEnabled()) return true;
    throw INVALID_ARGUMENT.create({
      detail:
        "This operation requires explicit confirmation in non-interactive mode. Re-run with --yes, or use --force when the command supports it.",
    });
  }

  ensureConfirmPromptAvailable({ interactive, stdoutTTY: isTTY() });

  const hint = defaultValue ? "[Y/n]" : "[y/N]";
  const response = await promptUser(`${message} ${hint} `);

  if (!response) return defaultValue;

  const normalized = response.toLowerCase().trim();
  return normalized === "y" || normalized === "yes";
}

export function ensureConfirmPromptAvailable(options: {
  interactive: boolean;
  stdoutTTY: boolean;
}): void {
  if (!options.interactive || options.stdoutTTY) return;

  throw INVALID_ARGUMENT.create({
    detail:
      "Confirmation required but no interactive prompt is available. Re-run with --yes to confirm without prompting, or use --force when the command supports it.",
  });
}

/** Exit the process with the given code. */
export function exitProcess(code: number): void {
  exit(code);
}
