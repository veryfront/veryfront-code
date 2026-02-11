import denoConfig from "../../deno.json" with { type: "json" };
import { exit, getEnv, isStdoutTTY, onSignal, promptSync } from "veryfront/platform";
import { DEFAULT_DEV_PORT } from "../shared/constants.ts";
import {
  bold,
  brand,
  dim,
  error as errorColor,
  muted,
  shouldUseColor,
  success as successColor,
  warning as warningColor,
} from "../ui/colors.ts";

type LoggerMethod = (...args: unknown[]) => void;

function debugEnabled(): boolean {
  return _verboseMode || getEnv("VERYFRONT_DEBUG") === "1";
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
    if (!debugEnabled()) return;
    console.debug(...args);
  },
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  child: () => cliLogger,
  // CLI logger uses plain text output; component names are intentionally ignored.
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

export function showLogo(): void {
  if (!shouldUseColor()) {
    cliLogger.info(`
⚡ Veryfront v${VERSION}
──────────────────────
`);
    return;
  }

  cliLogger.info(`
${brand("⚡")} ${bold(brand("Veryfront"))} ${dim(`v${VERSION}`)}
${muted("──────────────────────")}
`);
}

export function logSuccess(message: string): void {
  console.log(`  ${successColor("✓")} ${message}`);
}

export function logError(message: string): void {
  console.error(`  ${errorColor("✗")} ${message}`);
}

export function logWarning(message: string): void {
  console.warn(`  ${warningColor("!")} ${message}`);
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
      void handler(signal);
    });
  }
}

let _verboseMode = false;
let _quietMode = false;

export function setVerboseMode(enabled: boolean): void {
  _verboseMode = enabled;
  if (enabled) _quietMode = false;
}

export function setQuietMode(enabled: boolean): void {
  _quietMode = enabled;
  if (enabled) _verboseMode = false;
}

export function isVerbose(): boolean {
  return _verboseMode;
}

export function isQuiet(): boolean {
  return _quietMode;
}

export function promptUser(message: string): Promise<string> {
  const input = promptSync(message);
  return Promise.resolve(input?.trim() ?? "");
}

export async function confirmPrompt(
  message: string,
  defaultValue = false,
): Promise<boolean> {
  if (!isTTY()) return defaultValue;

  const hint = defaultValue ? "[Y/n]" : "[y/N]";
  const response = await promptUser(`${message} ${hint} `);

  if (!response) return defaultValue;

  const normalized = response.toLowerCase().trim();
  return normalized === "y" || normalized === "yes";
}

export function exitProcess(code: number): void {
  exit(code);
}
