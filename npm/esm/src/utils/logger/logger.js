import * as dntShim from "../../../_dnt.shims.js";
import { getEnvironmentVariable } from "./env.js";
import { hasDenoRuntime, hasNodeProcess } from "../runtime-guards.js";
import { VERSION } from "../version.js";
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
let cachedConfig = null;
let cachedEnvLevel;
let cachedDebugFlag;
let cachedEnvFormat;
let cachedEnvMode;
/**
 * Reset the cached logger configuration.
 * This is only intended for testing purposes to ensure fresh config evaluation.
 * @internal
 */
export function __resetLoggerConfigForTesting() {
    cachedConfig = null;
    cachedEnvLevel = undefined;
    cachedDebugFlag = undefined;
    cachedEnvFormat = undefined;
    cachedEnvMode = undefined;
}
function resolveLoggerConfig() {
    const envLevel = getEnvironmentVariable("LOG_LEVEL");
    const debugFlag = getEnvironmentVariable("VERYFRONT_DEBUG");
    const envFormat = getEnvironmentVariable("LOG_FORMAT");
    const envMode = getEnvironmentVariable("NODE_ENV");
    if (cachedConfig &&
        envLevel === cachedEnvLevel &&
        debugFlag === cachedDebugFlag &&
        envFormat === cachedEnvFormat &&
        envMode === cachedEnvMode) {
        return cachedConfig;
    }
    cachedEnvLevel = envLevel;
    cachedDebugFlag = debugFlag;
    cachedEnvFormat = envFormat;
    cachedEnvMode = envMode;
    cachedConfig = {
        level: getDefaultLevel(envLevel, debugFlag),
        format: getDefaultFormat(envFormat, envMode),
    };
    return cachedConfig;
}
/**
 * Determine log format from environment.
 * Defaults to JSON in production for Grafana compatibility.
 */
function getDefaultFormat(envFormat = getEnvironmentVariable("LOG_FORMAT"), envMode = getEnvironmentVariable("NODE_ENV")) {
    if (envFormat === "json" || envFormat === "text")
        return envFormat;
    return envMode === "production" ? "json" : "text";
}
/**
 * Serialize error object for structured logging.
 */
function serializeError(error) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message, stack: error.stack };
    }
    if (error == null)
        return undefined;
    return { name: "UnknownError", message: String(error) };
}
/**
 * Extract context from variadic args.
 * First object argument becomes context, errors are handled specially.
 */
function extractContext(args) {
    let context;
    let error;
    for (const arg of args) {
        if (arg instanceof Error) {
            error = serializeError(arg);
            continue;
        }
        if (typeof arg === "object" && arg !== null && !Array.isArray(arg)) {
            context = { ...context, ...arg };
        }
    }
    return { context, error };
}
const TAG_WIDTH = 10;
const LEVEL_GLYPHS = {
    debug: "·",
    info: "●",
    warn: "▲",
    error: "✖",
};
const ANSI = {
    reset: "\u001b[0m",
    dim: "\u001b[2m",
    gray: "\u001b[90m",
    red: "\u001b[31m",
    green: "\u001b[32m",
    yellow: "\u001b[33m",
    blue: "\u001b[34m",
    magenta: "\u001b[35m",
    cyan: "\u001b[36m",
};
const TAG_COLORS = {
    CLI: ANSI.green,
    SERVER: ANSI.blue,
    RENDERER: ANSI.magenta,
    BUNDLER: ANSI.yellow,
    AGENT: ANSI.cyan,
    PROXY: ANSI.cyan,
    VERYFRONT: ANSI.cyan,
};
const LEVEL_COLORS = {
    debug: ANSI.gray,
    info: ANSI.green,
    warn: ANSI.yellow,
    error: ANSI.red,
};
function padTag(tag) {
    if (tag.length >= TAG_WIDTH)
        return tag.slice(0, TAG_WIDTH);
    return tag.padEnd(TAG_WIDTH, " ");
}
function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function isTty() {
    try {
        if (hasDenoRuntime(dntShim.dntGlobalThis)) {
            return Boolean(dntShim.dntGlobalThis.Deno?.stdout?.isTerminal?.());
        }
        if (hasNodeProcess(dntShim.dntGlobalThis)) {
            return Boolean(dntShim.dntGlobalThis.process?.stdout
                ?.isTTY);
        }
    }
    catch {
        return false;
    }
    return false;
}
function shouldUseColor() {
    const noColor = getEnvironmentVariable("NO_COLOR");
    const forceColor = getEnvironmentVariable("FORCE_COLOR");
    const logColor = getEnvironmentVariable("LOG_COLOR");
    if (forceColor === "0" || logColor === "0")
        return false;
    if (noColor !== undefined)
        return false;
    if (getEnvironmentVariable("CI") !== undefined)
        return false;
    if (forceColor || logColor === "1" || logColor === "true")
        return true;
    return isTty();
}
function colorize(text, color, enable) {
    if (!enable || !color)
        return text;
    return `${color}${text}${ANSI.reset}`;
}
function normalizeText(value) {
    return value.replace(/\s+/g, " ");
}
function truncateText(value, maxLength = 80) {
    if (value.length <= maxLength)
        return value;
    return `${value.slice(0, maxLength - 1)}…`;
}
function formatValue(value) {
    if (typeof value === "string") {
        const trimmed = normalizeText(value);
        return /\s/.test(trimmed) ? JSON.stringify(trimmed) : trimmed;
    }
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (value === null)
        return "null";
    if (value === undefined)
        return "undefined";
    let text;
    try {
        text = JSON.stringify(value);
    }
    catch {
        text = String(value);
    }
    // JSON.stringify can return undefined for certain values (e.g., functions, symbols)
    if (text === undefined)
        return "undefined";
    return truncateText(normalizeText(text));
}
function formatErrorText(error) {
    return truncateText(normalizeText(`${error.name}: ${error.message}`), 120);
}
// Prefix width: timestamp(8) + gap(2) + tag(10) + space(1) + glyph(1) + space(1) = 23
const PREFIX_WIDTH = 23;
function formatContextText(context, error, enableColor) {
    const entries = Object.entries(context).map(([key, value]) => `${key}=${formatValue(value)}`);
    if (error)
        entries.push(`err=${formatErrorText(error)}`);
    if (entries.length === 0)
        return "";
    const indent = " ".repeat(PREFIX_WIDTH);
    return `\n${indent}${colorize(entries.join(" "), ANSI.dim, enableColor)}`;
}
function extractToEntryField(entry, context, key, coerce) {
    if (!(key in context))
        return;
    entry[key] = coerce(context[key]);
    delete context[key];
}
class ConsoleLogger {
    prefix;
    boundContext;
    constructor(prefix, boundContext) {
        this.prefix = prefix;
        this.boundContext = boundContext ?? {};
    }
    child(context) {
        return new ConsoleLogger(this.prefix, { ...this.boundContext, ...context });
    }
    formatJson(level, message, args) {
        const { context, error } = extractContext(args);
        const mergedContext = { ...this.boundContext, ...context };
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.prefix.toLowerCase(),
            veryfrontVersion: VERSION,
            message,
        };
        // Extract known fields to top level for easier Grafana filtering
        extractToEntryField(entry, mergedContext, "requestId", (v) => String(v));
        extractToEntryField(entry, mergedContext, "traceId", (v) => String(v));
        extractToEntryField(entry, mergedContext, "projectSlug", (v) => String(v));
        extractToEntryField(entry, mergedContext, "durationMs", (v) => Number(v));
        // Extract standard fields for Loki filtering
        extractToEntryField(entry, mergedContext, "project_slug", (v) => String(v));
        extractToEntryField(entry, mergedContext, "request_url", (v) => String(v));
        extractToEntryField(entry, mergedContext, "domain", (v) => String(v));
        extractToEntryField(entry, mergedContext, "project_id", (v) => String(v));
        extractToEntryField(entry, mergedContext, "release_id", (v) => String(v));
        extractToEntryField(entry, mergedContext, "branch_id", (v) => String(v));
        extractToEntryField(entry, mergedContext, "branch_name", (v) => String(v));
        if (Object.keys(mergedContext).length > 0)
            entry.context = mergedContext;
        if (error)
            entry.error = error;
        return JSON.stringify(entry);
    }
    formatTextLine(level, message, args) {
        const { context, error } = extractContext(args);
        const mergedContext = { ...this.boundContext, ...context };
        const enableColor = shouldUseColor();
        const timestamp = colorize(formatTimestamp(), ANSI.dim, enableColor);
        const tag = colorize(padTag(this.prefix), TAG_COLORS[this.prefix] ?? ANSI.cyan, enableColor);
        const glyph = colorize(LEVEL_GLYPHS[level], LEVEL_COLORS[level], enableColor);
        const contextText = formatContextText(mergedContext, error, enableColor);
        return `${timestamp}  ${tag} ${glyph} ${message}${contextText}`;
    }
    log(level, logLevel, consoleFn, message, args) {
        const { level: resolvedLevel, format: resolvedFormat } = resolveLoggerConfig();
        if (resolvedLevel > logLevel)
            return;
        const line = resolvedFormat === "json"
            ? this.formatJson(level, message, args)
            : this.formatTextLine(level, message, args);
        consoleFn(line);
    }
    debug(message, ...args) {
        this.log("debug", LogLevel.DEBUG, console.debug, message, args);
    }
    info(message, ...args) {
        this.log("info", LogLevel.INFO, console.log, message, args);
    }
    warn(message, ...args) {
        this.log("warn", LogLevel.WARN, console.warn, message, args);
    }
    error(message, ...args) {
        this.log("error", LogLevel.ERROR, console.error, message, args);
    }
    async time(label, fn) {
        const start = performance.now();
        try {
            const result = await fn();
            const durationMs = performance.now() - start;
            this.debug(`${label} completed`, { durationMs: Math.round(durationMs) });
            return result;
        }
        catch (error) {
            const durationMs = performance.now() - start;
            this.error(`${label} failed`, { durationMs: Math.round(durationMs) }, error);
            throw error;
        }
    }
}
const LOG_LEVEL_MAP = {
    DEBUG: LogLevel.DEBUG,
    INFO: LogLevel.INFO,
    WARN: LogLevel.WARN,
    ERROR: LogLevel.ERROR,
};
function parseLogLevel(levelString) {
    if (!levelString)
        return undefined;
    return LOG_LEVEL_MAP[levelString.toUpperCase()];
}
/**
 * Determine the log level based on environment variables.
 * Exported for testing purposes.
 * @internal
 */
export function getDefaultLevel(envLevel = getEnvironmentVariable("LOG_LEVEL"), debugFlag = getEnvironmentVariable("VERYFRONT_DEBUG")) {
    const parsedLevel = parseLogLevel(envLevel);
    if (parsedLevel !== undefined)
        return parsedLevel;
    if (debugFlag === "1" || debugFlag === "true")
        return LogLevel.DEBUG;
    return LogLevel.INFO;
}
function createLogger(prefix) {
    return new ConsoleLogger(prefix);
}
// Base loggers without request context
const baseCliLogger = createLogger("CLI");
const baseServerLogger = createLogger("SERVER");
const baseRendererLogger = createLogger("RENDERER");
const baseBundlerLogger = createLogger("BUNDLER");
const baseAgentLogger = createLogger("AGENT");
const baseProxyLogger = createLogger("PROXY");
const baseLogger = createLogger("VERYFRONT");
/**
 * Request context getter - set by request-context.ts to avoid circular imports.
 * This pattern allows the logger module to be imported first without
 * depending on request-context.ts.
 */
let requestContextGetter = null;
/**
 * Register the request context getter.
 * Called by request-context.ts during module initialization.
 * @internal
 */
export function __registerRequestContextGetter(getter) {
    requestContextGetter = getter;
}
/**
 * Create a context-aware logger proxy that automatically uses
 * request-scoped context from AsyncLocalStorage when available.
 */
function createContextAwareLogger(baseLogger) {
    return {
        debug(message, ...args) {
            const ctx = requestContextGetter?.();
            const logger = ctx?.logger ?? baseLogger;
            logger.debug(message, ...args);
        },
        info(message, ...args) {
            const ctx = requestContextGetter?.();
            const logger = ctx?.logger ?? baseLogger;
            logger.info(message, ...args);
        },
        warn(message, ...args) {
            const ctx = requestContextGetter?.();
            const logger = ctx?.logger ?? baseLogger;
            logger.warn(message, ...args);
        },
        error(message, ...args) {
            const ctx = requestContextGetter?.();
            const logger = ctx?.logger ?? baseLogger;
            logger.error(message, ...args);
        },
        time(label, fn) {
            const ctx = requestContextGetter?.();
            const logger = ctx?.logger ?? baseLogger;
            return logger.time(label, fn);
        },
        child(context) {
            const ctx = requestContextGetter?.();
            const logger = ctx?.logger ?? baseLogger;
            return logger.child(context);
        },
    };
}
// Context-aware loggers that automatically include request context
export const cliLogger = createContextAwareLogger(baseCliLogger);
export const serverLogger = createContextAwareLogger(baseServerLogger);
export const rendererLogger = createContextAwareLogger(baseRendererLogger);
export const bundlerLogger = createContextAwareLogger(baseBundlerLogger);
export const agentLogger = createContextAwareLogger(baseAgentLogger);
export const proxyLogger = createContextAwareLogger(baseProxyLogger);
export const logger = createContextAwareLogger(baseLogger);
/**
 * Get the base logger without request context awareness.
 * Use this when you need to create a request-scoped logger in middleware.
 */
export function getBaseLogger(prefix) {
    switch (prefix.toUpperCase()) {
        case "CLI":
            return baseCliLogger;
        case "SERVER":
            return baseServerLogger;
        case "RENDERER":
            return baseRendererLogger;
        case "BUNDLER":
            return baseBundlerLogger;
        case "AGENT":
            return baseAgentLogger;
        case "PROXY":
            return baseProxyLogger;
        default:
            return baseLogger;
    }
}
/**
 * Create a logger for a specific request context.
 * Useful for binding request-specific metadata to all logs.
 */
export function createRequestLogger(baseLogger, requestContext) {
    return baseLogger.child(requestContext);
}
