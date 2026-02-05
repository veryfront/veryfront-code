import { cliLogger, formatBytes, VERSION } from "#veryfront/utils";
import { bold, cyan, dim, green, red, yellow } from "#veryfront/compat/console";
import {
  exit,
  isInteractive,
  isStdoutTTY,
  onSignal,
  promptSync,
  writeStdout,
} from "#veryfront/platform/compat/process.ts";
import { getForceColorEnv, getNoColorEnv } from "#veryfront/config/env.ts";

export function isTTY(): boolean {
  return isStdoutTTY();
}

export function isStderrTTY(): boolean {
  return isInteractive();
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
  console.log(`  ${green("✓")} ${message}`);
}

export function logError(message: string): void {
  console.error(`  ${red("✗")} ${message}`);
}

export function logWarning(message: string): void {
  console.warn(`  ${yellow("!")} ${message}`);
}

export function logInfo(message: string): void {
  console.log(`  ${dim("›")} ${message}`);
}

export function registerTerminationSignals(
  handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>,
): () => void {
  const signals: Array<"SIGINT" | "SIGTERM"> = ["SIGINT", "SIGTERM"];

  for (const signal of signals) {
    onSignal(signal, () => {
      void handler(signal);
    });
  }

  return () => {};
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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Spinner {
  start: () => void;
  stop: (finalMessage?: string) => void;
  update: (message: string) => void;
}

export function createNoopSpinner(): Spinner {
  return {
    start() {},
    stop() {},
    update() {},
  };
}

export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let currentMessage = message;
  const interactive = isTTY();

  function clearLine(): void {
    if (!interactive) return;
    writeStdout("\r\x1b[K");
  }

  function render(): void {
    if (!interactive) return;

    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? "⠋";
    const outputFrame = getColorEnabled() ? cyan(frame) : frame;

    writeStdout(`\r${outputFrame} ${currentMessage}`);
    frameIndex++;
  }

  return {
    start(): void {
      if (!interactive) {
        cliLogger.info(`... ${message}`);
        return;
      }

      render();
      intervalId = setInterval(render, 80);
    },
    stop(finalMessage?: string): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      clearLine();
      if (finalMessage) cliLogger.info(finalMessage);
    },
    update(newMessage: string): void {
      currentMessage = newMessage;
      if (!interactive) cliLogger.info(`... ${newMessage}`);
    },
  };
}

export function exitProcess(code: number): void {
  exit(code);
}

export { formatBytes };
