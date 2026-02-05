import { cliLogger, formatBytes, VERSION } from "#veryfront/utils";
import { bold, cyan, dim } from "#veryfront/compat/console";
import { exit, isStdoutTTY, onSignal, promptSync } from "#veryfront/platform/compat/process.ts";
import { getForceColorEnv, getNoColorEnv } from "#veryfront/config/env.ts";
import {
  error as errorColor,
  success as successColor,
  warning as warningColor,
} from "../ui/colors.ts";

export function isTTY(): boolean {
  return isStdoutTTY();
}

let _colorEnabled: boolean | undefined;

export function shouldUseColor(forceColor?: boolean): boolean {
  if (forceColor !== undefined) return forceColor;

  if (getNoColorEnv()) return false;

  const forceColorEnv = getForceColorEnv();
  if (forceColorEnv && forceColorEnv !== "0") return true;

  return isTTY();
}

export function setColorMode(enabled: boolean | undefined): void {
  _colorEnabled = enabled;
}

export function getColorEnabled(): boolean {
  return shouldUseColor(_colorEnabled);
}

export function stripColors(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function conditionalColor<T extends (s: string) => string>(
  colorFn: T,
  text: string,
): string {
  return getColorEnabled() ? colorFn(text) : text;
}

function colorize(useColor: boolean, fn: (s: string) => string, s: string): string {
  return useColor ? fn(s) : s;
}

export function showLogo(): void {
  const useColor = getColorEnabled();

  cliLogger.info(`
${colorize(useColor, cyan, "⚡")} ${
    colorize(useColor, bold, colorize(useColor, cyan, "Veryfront"))
  } ${colorize(useColor, dim, `v${VERSION}`)}
${colorize(useColor, dim, "──────────────────────")}
`);
}

export function showVersion(): void {
  console.log(`  veryfront v${VERSION}`);
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

export function logVerbose(message: string): void {
  if (!_verboseMode) return;
  cliLogger.info(dim(`[verbose] ${message}`));
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

export { formatBytes };
