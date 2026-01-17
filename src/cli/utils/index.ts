import { VERSION } from "@veryfront/utils";
import { bold, cyan, dim, green, red, yellow } from "@veryfront/compat/console";
import { cliLogger } from "@veryfront/utils";
import { exit } from "@veryfront/platform/compat/process.ts";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import { getForceColorEnv, getNoColorEnv } from "@veryfront/config/env.ts";

// ============================================================================
// TTY and Color Detection (clig.dev compliance)
// ============================================================================

/**
 * Check if stdout is a TTY (interactive terminal)
 * @returns true if stdout is a TTY
 */
export function isTTY(): boolean {
  if (isDeno) {
    // @ts-ignore - Deno global
    return typeof Deno !== "undefined" && Deno.stdout?.isTerminal?.() === true;
  }
  // Node.js/Bun
  return typeof process !== "undefined" && process.stdout?.isTTY === true;
}

/**
 * Check if stderr is a TTY
 * @returns true if stderr is a TTY
 */
export function isStderrTTY(): boolean {
  if (isDeno) {
    // @ts-ignore - Deno global
    return typeof Deno !== "undefined" && Deno.stderr?.isTerminal?.() === true;
  }
  return typeof process !== "undefined" && process.stderr?.isTTY === true;
}

/**
 * Determine if colors should be used in output
 * Respects NO_COLOR environment variable (https://no-color.org/)
 * and checks if output is a TTY
 *
 * @param forceColor - Optional flag to force color on/off (from --color/--no-color flags)
 * @returns true if colors should be used
 */
export function shouldUseColor(forceColor?: boolean): boolean {
  // If explicitly forced via CLI flag, respect that
  if (forceColor !== undefined) {
    return forceColor;
  }

  // Check NO_COLOR environment variable (https://no-color.org/)
  const noColor = getNoColorEnv();
  if (noColor !== undefined && noColor !== "") {
    return false;
  }

  // Check FORCE_COLOR environment variable
  const forceColorEnv = getForceColorEnv();
  if (forceColorEnv !== undefined && forceColorEnv !== "0") {
    return true;
  }

  // Default: use color only if stdout is a TTY
  return isTTY();
}

// Global color state - can be set by CLI flags
let _colorEnabled: boolean | undefined;

/**
 * Set global color mode (used by CLI to propagate --no-color flag)
 */
export function setColorMode(enabled: boolean | undefined): void {
  _colorEnabled = enabled;
}

/**
 * Get current color mode
 */
export function getColorEnabled(): boolean {
  return shouldUseColor(_colorEnabled);
}

/**
 * Strip ANSI color codes from a string
 */
export function stripColors(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Conditionally apply color function based on color mode
 */
export function conditionalColor<T extends (s: string) => string>(
  colorFn: T,
  text: string,
): string {
  return getColorEnabled() ? colorFn(text) : text;
}

// Logo and help display
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
  // veryfront.config.js
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
  console.log(`  veryfront v${VERSION}`);
}

// Logging utilities using new clean style
export function logSuccess(message: string) {
  console.log(`  ${green("✓")} ${message}`);
}

export function logError(message: string) {
  console.error(`  ${red("✗")} ${message}`);
}

export function logWarning(message: string) {
  console.warn(`  ${yellow("!")} ${message}`);
}

export function logInfo(message: string) {
  console.log(`  ${dim("›")} ${message}`);
}

/**
 * Register handlers for termination signals in both Node/Bun and Deno runtimes.
 * Returns a cleanup function to remove listeners.
 */
export function registerTerminationSignals(
  handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>,
): () => void {
  const cleanupFns: Array<() => void> = [];
  const signals: Array<"SIGINT" | "SIGTERM"> = ["SIGINT", "SIGTERM"];

  for (const signal of signals) {
    // Deno (with Node compat available)
    if (typeof Deno !== "undefined" && "addSignalListener" in Deno) {
      const listener = () => {
        void handler(signal);
      };
      // @ts-ignore - Deno types are available at runtime when using Deno
      Deno.addSignalListener(signal, listener);
      cleanupFns.push(() => {
        try {
          // @ts-ignore - optional on older Deno versions
          Deno.removeSignalListener?.(signal, listener);
        } catch {
          /* ignore */
        }
      });
      continue;
    }

    // Node/Bun
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
            // @ts-ignore - removeListener exists on Node process
            process.removeListener?.(signal, listener);
          }
        } catch {
          /* ignore */
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

// ============================================================================
// Verbose/Quiet Mode (clig.dev compliance)
// ============================================================================

let _verboseMode = false;
let _quietMode = false;

/**
 * Set verbose mode (--verbose flag)
 */
export function setVerboseMode(enabled: boolean): void {
  _verboseMode = enabled;
  if (enabled) _quietMode = false; // Verbose overrides quiet
}

/**
 * Set quiet mode (--quiet flag)
 */
export function setQuietMode(enabled: boolean): void {
  _quietMode = enabled;
  if (enabled) _verboseMode = false; // Quiet overrides verbose
}

/**
 * Check if verbose mode is enabled
 */
export function isVerbose(): boolean {
  return _verboseMode;
}

/**
 * Check if quiet mode is enabled
 */
export function isQuiet(): boolean {
  return _quietMode;
}

/**
 * Log verbose message (only shown with --verbose)
 */
export function logVerbose(message: string): void {
  if (_verboseMode) {
    cliLogger.info(dim(`[verbose] ${message}`));
  }
}

// ============================================================================
// User Interaction & Prompts
// ============================================================================

/**
 * Prompt user for text input
 */
export async function promptUser(message: string): Promise<string> {
  cliLogger.info(message);

  if (isDeno) {
    // Deno-specific stdin reading
    const buf = new Uint8Array(1024);
    // @ts-ignore - Deno global
    const n = await Deno.stdin.read(buf);
    if (n === null) {
      return "";
    }
    const input = new TextDecoder().decode(buf.subarray(0, n));
    return input.trim();
  } else {
    // Node.js/Bun fallback using readline
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

/**
 * Prompt user for yes/no confirmation
 * @param message - The confirmation message to display
 * @param defaultValue - Default value if user just presses Enter (default: false)
 * @returns true if confirmed, false otherwise
 */
export async function confirmPrompt(
  message: string,
  defaultValue = false,
): Promise<boolean> {
  // If not interactive (not a TTY), return default value
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

// ============================================================================
// Progress Spinner (clig.dev compliance)
// ============================================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Spinner {
  start: () => void;
  stop: (finalMessage?: string) => void;
  update: (message: string) => void;
}

/**
 * Create a progress spinner for long-running operations
 * Only shows spinner if stdout is a TTY
 *
 * @param message - Initial spinner message
 * @returns Spinner control object
 */
export function createSpinner(message: string): Spinner {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let currentMessage = message;
  const isInteractive = isTTY();

  const clearLine = () => {
    if (isInteractive) {
      // Move cursor to beginning of line and clear it
      process.stdout?.write?.("\r\x1b[K");
    }
  };

  const render = () => {
    if (!isInteractive) return;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? "⠋";
    const coloredFrame = getColorEnabled() ? cyan(frame) : frame;
    process.stdout?.write?.(`\r${coloredFrame} ${currentMessage}`);
    frameIndex++;
  };

  return {
    start: () => {
      if (!isInteractive) {
        // Non-interactive: just log the message once
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

// Process utilities
/**
 * Exit the process with a given code
 * @param code - Exit code
 */
export function exitProcess(code: number): void {
  exit(code);
}

// Re-export formatBytes from shared format utils for backward compatibility
export { formatBytes } from "@veryfront/utils";
