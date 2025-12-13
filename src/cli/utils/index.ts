import { VERSION } from "@veryfront/utils";
import { bold, cyan, dim, yellow } from "@veryfront/compat/console";
import { cliLogger } from "@veryfront/utils";
import { exit } from "../../platform/compat/process.ts";
import { isDeno } from "../../platform/compat/runtime.ts";


export function isTTY(): boolean {
  if (isDeno) {
    return typeof Deno !== "undefined" && Deno.stdout?.isTerminal?.() === true;
  }
  return typeof process !== "undefined" && process.stdout?.isTTY === true;
}

export function isStderrTTY(): boolean {
  if (isDeno) {
    return typeof Deno !== "undefined" && Deno.stderr?.isTerminal?.() === true;
  }
  return typeof process !== "undefined" && process.stderr?.isTTY === true;
}

export function shouldUseColor(forceColor?: boolean): boolean {
  if (forceColor !== undefined) {
    return forceColor;
  }

  const noColor = getEnv("NO_COLOR");
  if (noColor !== undefined && noColor !== "") {
    return false;
  }

  const forceColorEnv = getEnv("FORCE_COLOR");
  if (forceColorEnv !== undefined && forceColorEnv !== "0") {
    return true;
  }

  return isTTY();
}

function getEnv(name: string): string | undefined {
  if (isDeno) {
    return Deno.env?.get?.(name);
  }
  return process?.env?.[name];
}

let _colorEnabled: boolean | undefined;

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

export function showLogo() {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  cliLogger.info(`
${c(cyan, "⚡")} ${c(bold, c(cyan, "Veryfront"))} ${c(dim, `v${VERSION}`)}
${c(dim, "──────────────────────")}
`);
}

export function showHelp() {
  showLogo();
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  cliLogger.info(`
${c(yellow, "Usage:")} veryfront <command> [options]

${c(cyan, "Commands:")}
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

${c(cyan, "Global Options:")}
  --version       Show version information
  --help          Show this help message
  -q, --quiet     Suppress non-essential output
  --verbose       Show detailed output
  --no-color      Disable colored output (respects NO_COLOR env)
  --color         Force colored output
  -f, --force     Skip confirmation prompts

${c(cyan, "Examples:")}
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

${c(cyan, "Config tips:")}
  export default {
    generate: { preferredRouter: "app-router" },
    security: { remoteHosts: ["https://esm.sh", "https://deno.land"] }
  }

${c(cyan, "Docs:")}
  RSC Security & Actions: docs/RSC_SECURITY_AND_ACTIONS.md
  Server Actions: docs/server-actions.md
  Caching: docs/caching.md
  Security (CSP/CORS): docs/security.md
  Migration (Beta→v1): MIGRATION.md

Version: ${VERSION}
`);
}

export function showVersion() {
  cliLogger.info(`Veryfront v${VERSION}`);
}

export function logSuccess(message: string) {
  cliLogger.info(`✅ ${message}`);
}

export function logError(message: string) {
  console.error(`❌ ${message}`);
}

export function logWarning(message: string) {
  console.warn(`⚠️  ${message}`);
}

export function logInfo(message: string) {
  cliLogger.info(`ℹ️  ${message}`);
}

export function registerTerminationSignals(
  handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>,
): () => void {
  const cleanupFns: Array<() => void> = [];
  const signals: Array<"SIGINT" | "SIGTERM"> = ["SIGINT", "SIGTERM"];

  for (const signal of signals) {
    if (typeof Deno !== "undefined" && "addSignalListener" in Deno) {
      const listener = () => {
        void handler(signal);
      };
      Deno.addSignalListener(signal, listener);
      cleanupFns.push(() => {
        try {
          Deno.removeSignalListener?.(signal, listener);
        } catch {
        }
      });
      continue;
    }

    if (typeof process !== "undefined" && typeof process.on === "function") {
      const listener = () => {
        void handler(signal);
      };
      process.on(signal, listener);
      cleanupFns.push(() => {
        try {
          if (typeof process.off === "function") {
            process.off(signal, listener);
          } else {
            process.removeListener?.(signal, listener);
          }
        } catch {
        }
      });
    }
  }

  return () => {
    for (const cleanup of cleanupFns) {
      cleanup();
    }
  };
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
  if (_verboseMode) {
    cliLogger.info(dim(`[verbose] ${message}`));
  }
}


export async function promptUser(message: string): Promise<string> {
  cliLogger.info(message);

  if (isDeno) {
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    if (n === null) {
      return "";
    }
    const input = new TextDecoder().decode(buf.subarray(0, n));
    return input.trim();
  } else {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question("", (answer: string) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }
}

export async function confirmPrompt(
  message: string,
  defaultValue = false,
): Promise<boolean> {
  if (!isTTY()) {
    return defaultValue;
  }

  const hint = defaultValue ? "[Y/n]" : "[y/N]";
  const response = await promptUser(`${message} ${hint} `);

  if (response === "") {
    return defaultValue;
  }

  const normalized = response.toLowerCase().trim();
  return normalized === "y" || normalized === "yes";
}


const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Spinner {
  start: () => void;
  stop: (finalMessage?: string) => void;
  update: (message: string) => void;
}

/** Helper to write to stdout in a cross-platform way */
function writeToStdout(text: string): void {
  if (isDeno) {
    // @ts-ignore - Deno global
    Deno?.stdout?.writeSync?.(new TextEncoder().encode(text));
  } else if (typeof process !== "undefined") {
    process.stdout?.write?.(text);
  }
}

export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let currentMessage = message;
  const isInteractive = isTTY();

  const clearLine = () => {
    if (isInteractive) {
      writeToStdout("\r\x1b[K");
    }
  };

  const render = () => {
    if (!isInteractive) return;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? "⠋";
    const coloredFrame = getColorEnabled() ? cyan(frame) : frame;
    writeToStdout(`\r${coloredFrame} ${currentMessage}`);
    frameIndex++;
  };

  return {
    start: () => {
      if (!isInteractive) {
        cliLogger.info(`... ${message}`);
        return;
      }
      render();
      intervalId = setInterval(render, 80);
    },
    stop: (finalMessage?: string) => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearLine();
      if (finalMessage) {
        cliLogger.info(finalMessage);
      }
    },
    update: (newMessage: string) => {
      currentMessage = newMessage;
      if (!isInteractive) {
        cliLogger.info(`... ${newMessage}`);
      }
    },
  };
}

export function exitProcess(code: number): void {
  exit(code);
}

export { formatBytes } from "@veryfront/utils";
