import { cliLogger, formatBytes, VERSION } from "#veryfront/utils";
import { exit, isStdoutTTY, onSignal, promptSync } from "#veryfront/platform/compat/process.ts";
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
