import * as dntShim from "../../../_dnt.shims.js";
import { cliLogger, formatBytes, VERSION } from "../../utils/index.js";
import { bold, cyan, dim, green, red, yellow } from "../../platform/compat/console/index.js";
import { exit, isInteractive, isStdoutTTY, onSignal, promptSync, writeStdout, } from "../../platform/compat/process.js";
import { getForceColorEnv, getNoColorEnv } from "../../config/env.js";
export function isTTY() {
    return isStdoutTTY();
}
export function isStderrTTY() {
    return isInteractive();
}
let _colorEnabled;
export function shouldUseColor(forceColor) {
    if (forceColor !== undefined)
        return forceColor;
    const noColor = getNoColorEnv();
    if (noColor)
        return false;
    const forceColorEnv = getForceColorEnv();
    if (forceColorEnv && forceColorEnv !== "0")
        return true;
    return isTTY();
}
export function setColorMode(enabled) {
    _colorEnabled = enabled;
}
export function getColorEnabled() {
    return shouldUseColor(_colorEnabled);
}
export function stripColors(str) {
    // deno-lint-ignore no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, "");
}
export function conditionalColor(colorFn, text) {
    return getColorEnabled() ? colorFn(text) : text;
}
function colorize(useColor, fn, s) {
    return useColor ? fn(s) : s;
}
export function showLogo() {
    const useColor = getColorEnabled();
    cliLogger.info(`
${colorize(useColor, cyan, "⚡")} ${colorize(useColor, bold, colorize(useColor, cyan, "Veryfront"))} ${colorize(useColor, dim, `v${VERSION}`)}
${colorize(useColor, dim, "──────────────────────")}
`);
}
export function showHelp() {
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
export function showVersion() {
    console.log(`  veryfront v${VERSION}`);
}
export function logSuccess(message) {
    console.log(`  ${green("✓")} ${message}`);
}
export function logError(message) {
    console.error(`  ${red("✗")} ${message}`);
}
export function logWarning(message) {
    console.warn(`  ${yellow("!")} ${message}`);
}
export function logInfo(message) {
    console.log(`  ${dim("›")} ${message}`);
}
export function registerTerminationSignals(handler) {
    const signals = ["SIGINT", "SIGTERM"];
    for (const signal of signals) {
        onSignal(signal, () => void handler(signal));
    }
    return () => { };
}
let _verboseMode = false;
let _quietMode = false;
export function setVerboseMode(enabled) {
    _verboseMode = enabled;
    if (enabled)
        _quietMode = false;
}
export function setQuietMode(enabled) {
    _quietMode = enabled;
    if (enabled)
        _verboseMode = false;
}
export function isVerbose() {
    return _verboseMode;
}
export function isQuiet() {
    return _quietMode;
}
export function logVerbose(message) {
    if (!_verboseMode)
        return;
    cliLogger.info(dim(`[verbose] ${message}`));
}
export function promptUser(message) {
    const input = promptSync(message);
    return Promise.resolve(input?.trim() ?? "");
}
export async function confirmPrompt(message, defaultValue = false) {
    if (!isTTY())
        return defaultValue;
    const hint = defaultValue ? "[Y/n]" : "[y/N]";
    const response = await promptUser(`${message} ${hint} `);
    if (!response)
        return defaultValue;
    const normalized = response.toLowerCase().trim();
    return normalized === "y" || normalized === "yes";
}
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/**
 * Create a no-op spinner that does nothing (for quiet mode)
 */
export function createNoopSpinner() {
    return {
        start() { },
        stop() { },
        update() { },
    };
}
export function createSpinner(message) {
    let frameIndex = 0;
    let intervalId = null;
    let currentMessage = message;
    const interactive = isTTY();
    function clearLine() {
        if (!interactive)
            return;
        writeStdout("\r\x1b[K");
    }
    function render() {
        if (!interactive)
            return;
        const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? "⠋";
        const outputFrame = getColorEnabled() ? cyan(frame) : frame;
        writeStdout(`\r${outputFrame} ${currentMessage}`);
        frameIndex++;
    }
    return {
        start() {
            if (!interactive) {
                cliLogger.info(`... ${message}`);
                return;
            }
            render();
            intervalId = dntShim.setInterval(render, 80);
        },
        stop(finalMessage) {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            clearLine();
            if (finalMessage)
                cliLogger.info(finalMessage);
        },
        update(newMessage) {
            currentMessage = newMessage;
            if (!interactive)
                cliLogger.info(`... ${newMessage}`);
        },
    };
}
export function exitProcess(code) {
    exit(code);
}
export { formatBytes };
