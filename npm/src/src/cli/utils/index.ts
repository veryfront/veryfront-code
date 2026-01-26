import * as dntShim from "../../../_dnt.shims.js";
import { cliLogger, formatBytes, VERSION } from "../../utils/index.js";
import { bold, cyan, dim, green, red, yellow } from "../../platform/compat/console/index.js";
import {
  exit,
  isInteractive,
  isStdoutTTY,
  onSignal,
  promptSync,
  writeStdout,
} from "../../platform/compat/process.js";
import { getForceColorEnv, getNoColorEnv } from "../../config/env.js";

export function isTTY(): boolean {
  return isStdoutTTY();
}

export function isStderrTTY(): boolean {
  return isInteractive();
}

let _colorEnabled: boolean | undefined;

export function shouldUseColor(forceColor?: boolean): boolean {
  if (forceColor !== undefined) return forceColor;

  const noColor = getNoColorEnv();
  if (noColor) return false;

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

function colorize(
  useColor: boolean,
  fn: (s: string) => string,
  s: string,
): string {
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

export function showHelp(): void {
  showLogo();
  const useColor = getColorEnabled();

  cliLogger.info(`
${colorize(useColor, yellow, "Usage:")} veryfront <command> [options]

${colorize(useColor, cyan, "Commands:")}
  init          Initialize a new Veryfront project
    -t, --template <name>  Template: minimal | app | blog | docs | ai (default: minimal)
    -w, --with <feature>   Add features: ai | auth | workflows | mdx | redis | blob
                           Can be specified multiple times: --with ai --with auth
  dev           Start development server
  build         Build for production
  serve         Start universal production server (no build required)
                 - Honors security.cors (CORS for API routes)
                 - Merges CSP with nonce per request
                 - Exposes /_metrics (requests, SSR, cache, RSC)
                 - Optional Redis cache via VERYFRONT_USE_REDIS_CACHE=1

  doctor        Check system requirements
               --strict, -s    Treat warnings as failures
  clean         Clean build cache
               --all           Remove node_modules, .deno, and .veryfront
               -f, --force     Skip confirmation prompts

  routes        Print discovered routes (pages + API)
                --json, -j      Output JSON
  generate, g   Generate scaffolds (page|layout|provider|api|rsc)

${colorize(useColor, cyan, "Global Options:")}
  --version       Show version information
  --help          Show this help message
  -q, --quiet     Suppress non-essential output
  --verbose       Show detailed output
  --no-color      Disable colored output (respects NO_COLOR env)
  --color         Force colored output
  -f, --force     Skip confirmation prompts

${colorize(useColor, cyan, "Examples:")}
  veryfront init my-app -t minimal
  veryfront init my-app -t app --with ai
  veryfront init my-app -t minimal --with ai --with auth
  veryfront dev --port 3000
  veryfront build --minify
  veryfront build --no-ssg            # disable static site generation
  veryfront build --include /docs --exclude /blog
  veryfront build --dry-run           # list SSG routes without writing files
  # HMR: browser reloads on file save; logs show ws path

  veryfront routes
  veryfront generate api users/[id]
  # Production server (CSP/CORS, APIs, RSC)
  veryfront serve --port 3000
  # With Redis cache adapter enabled
  VERYFRONT_USE_REDIS_CACHE=1 veryfront serve --port 3000
  # Clean all with force (no confirmation)
  veryfront clean --all --force
  # Disable colors in CI/CD
  NO_COLOR=1 veryfront build

${colorize(useColor, cyan, "Config tips:")}
  // veryfront.config.js
  export default {
    generate: { preferredRouter: "app-router" },
    security: { remoteHosts: ["https://esm.sh", "https://deno.land"] }
  }

${colorize(useColor, cyan, "Docs:")}
  RSC Security & Actions: docs/RSC_SECURITY_AND_ACTIONS.md
  Server Actions: docs/server-actions.md
  Caching: docs/caching.md
  Security (CSP/CORS): docs/security.md
  Migration (Beta→v1): MIGRATION.md

Version: ${VERSION}
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
    onSignal(signal, () => void handler(signal));
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

/**
 * Create a no-op spinner that does nothing (for quiet mode)
 */
export function createNoopSpinner(): Spinner {
  return {
    start() {},
    stop() {},
    update() {},
  };
}

export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof dntShim.setInterval> | null = null;
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
      intervalId = dntShim.setInterval(render, 80);
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
