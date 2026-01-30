// Inline cross-runtime getEnv to avoid dependency on src/platform/compat (not copied in Docker)
import * as dntShim from "../_dnt.shims.js";
function getEnv(key) {
    // Deno
    if (typeof dntShim.Deno !== "undefined" && dntShim.Deno.env?.get) {
        return dntShim.Deno.env.get(key);
    }
    // Node.js / Bun
    const nodeProcess = dntShim.dntGlobalThis.process;
    return nodeProcess?.env?.[key];
}
// Import version from root deno.json (the source of truth)
import denoConfig from "../deno.js";
import { getTraceContext } from "./tracing.js";
import { AsyncLocalStorage } from "node:async_hooks";
const requestContextStore = new AsyncLocalStorage();
/**
 * Run a function with proxy request context.
 * All logs within the function will include the request context fields.
 */
export function runWithProxyRequestContext(context, fn) {
    return requestContextStore.run(context, fn);
}
/**
 * Get the current proxy request context (if any).
 */
export function getProxyRequestContext() {
    return requestContextStore.getStore();
}
// Get version from environment variable or root deno.json
const VERYFRONT_VERSION = getEnv("VERYFRONT_VERSION") ??
    (typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0");
// Log level configuration
const MIN_LOG_LEVEL = (() => {
    const level = getEnv("LOG_LEVEL")?.toLowerCase();
    if (level === "debug" || level === "info" || level === "warn" ||
        level === "error") {
        return level;
    }
    return "info"; // Default: suppress debug logs
})();
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
    cyan: "\u001b[36m",
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
        if (typeof dntShim.Deno !== "undefined" &&
            typeof dntShim.Deno.stdout?.isTerminal === "function") {
            return dntShim.Deno.stdout.isTerminal();
        }
    }
    catch {
        // ignore
    }
    const stdout = dntShim.dntGlobalThis
        .process?.stdout;
    return stdout?.isTTY ?? false;
}
function shouldUseColor() {
    const noColor = getEnv("NO_COLOR");
    const forceColor = getEnv("FORCE_COLOR");
    const logColor = getEnv("LOG_COLOR");
    if (forceColor === "0" || logColor === "0")
        return false;
    if (noColor !== undefined)
        return false;
    if (getEnv("CI") !== undefined)
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
        if (/\s/.test(trimmed))
            return JSON.stringify(trimmed);
        return trimmed;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value === null)
        return "null";
    if (value === undefined)
        return "undefined";
    let text = "";
    try {
        text = JSON.stringify(value) ?? String(value);
    }
    catch {
        text = String(value);
    }
    return truncateText(normalizeText(text));
}
function formatErrorText(error) {
    if (!error)
        return "";
    const text = `${error.name}: ${error.message}`;
    return truncateText(normalizeText(text), 120);
}
// Prefix width: timestamp(8) + gap(2) + tag(10) + space(1) + glyph(1) + space(1) = 23
const PREFIX_WIDTH = 23;
function formatContextText(context, error, enableColor) {
    const entries = Object.entries(context).map(([key, value]) => `${key}=${formatValue(value)}`);
    if (error) {
        entries.push(`err=${formatErrorText(error)}`);
    }
    if (entries.length === 0)
        return "";
    const text = entries.join(" ");
    // Put context on new line, indented to align with message
    const indent = " ".repeat(PREFIX_WIDTH);
    return `\n${indent}${colorize(text, ANSI.dim, enableColor)}`;
}
function formatTextLine(level, message, context, error) {
    const enableColor = shouldUseColor();
    const timestamp = colorize(formatTimestamp(), ANSI.dim, enableColor);
    const tag = colorize(padTag("PROXY"), ANSI.cyan, enableColor);
    const glyph = colorize(LEVEL_GLYPHS[level], LEVEL_COLORS[level], enableColor);
    const contextText = formatContextText(context ?? {}, error, enableColor);
    return `${timestamp}  ${tag} ${glyph} ${message}${contextText}`;
}
function isProduction() {
    return getEnv("NODE_ENV") === "production";
}
function getLogFormat() {
    const format = getEnv("LOG_FORMAT");
    if (format === "json" || format === "text")
        return format;
    return isProduction() ? "json" : "text";
}
const LOG_LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function serializeError(err) {
    if (err instanceof Error) {
        return { name: err.name, message: err.message, stack: err.stack };
    }
    if (err !== undefined && err !== null) {
        return { name: "UnknownError", message: String(err) };
    }
    return undefined;
}
class ProxyLogger {
    format = getLogFormat();
    log(level, message, context, error) {
        // Filter by minimum log level
        if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[MIN_LOG_LEVEL]) {
            return;
        }
        if (this.format === "json") {
            const traceCtx = getTraceContext();
            const reqCtx = getProxyRequestContext();
            const entry = {
                timestamp: new Date().toISOString(),
                level,
                service: "proxy",
                veryfrontVersion: VERYFRONT_VERSION,
                message,
                ...(traceCtx.traceId &&
                    { traceId: traceCtx.traceId, spanId: traceCtx.spanId }),
                // Include request context fields at top level (like renderer logs)
                ...(reqCtx?.requestId && { requestId: reqCtx.requestId }),
                ...(reqCtx?.projectSlug && { projectSlug: reqCtx.projectSlug }),
                ...(reqCtx?.projectId && { projectId: reqCtx.projectId }),
                ...(reqCtx?.releaseId && { releaseId: reqCtx.releaseId }),
                ...(reqCtx?.branchId && { branchId: reqCtx.branchId }),
                ...(reqCtx?.branchName && { branchName: reqCtx.branchName }),
                ...(reqCtx?.domain && { domain: reqCtx.domain }),
                ...(reqCtx?.environment && { environment: reqCtx.environment }),
            };
            if (context && Object.keys(context).length > 0) {
                entry.context = context;
            }
            const serializedError = serializeError(error);
            if (serializedError) {
                entry.error = serializedError;
            }
            console.log(JSON.stringify(entry));
        }
        else {
            const serializedError = serializeError(error);
            console.log(formatTextLine(level, message, context, serializedError));
        }
    }
    debug(message, context) {
        this.log("debug", message, context);
    }
    info(message, context) {
        this.log("info", message, context);
    }
    warn(message, context) {
        this.log("warn", message, context);
    }
    error(message, contextOrError, error) {
        if (contextOrError instanceof Error || error !== undefined) {
            const ctx = contextOrError instanceof Error
                ? undefined
                : contextOrError;
            const err = contextOrError instanceof Error ? contextOrError : error;
            this.log("error", message, ctx, err);
        }
        else {
            this.log("error", message, contextOrError);
        }
    }
    /**
     * Create a child logger with bound context.
     */
    child(context) {
        return new ChildProxyLogger(this, context);
    }
}
class ChildProxyLogger {
    parent;
    boundContext;
    constructor(parent, boundContext) {
        this.parent = parent;
        this.boundContext = boundContext;
    }
    merge(ctx) {
        return { ...this.boundContext, ...ctx };
    }
    debug(message, context) {
        this.parent.debug(message, this.merge(context));
    }
    info(message, context) {
        this.parent.info(message, this.merge(context));
    }
    warn(message, context) {
        this.parent.warn(message, this.merge(context));
    }
    error(message, contextOrError, error) {
        if (contextOrError instanceof Error || error !== undefined) {
            const ctx = contextOrError instanceof Error
                ? this.boundContext
                : this.merge(contextOrError);
            const err = contextOrError instanceof Error ? contextOrError : error;
            this.parent.error(message, ctx, err);
        }
        else {
            this.parent.error(message, this.merge(contextOrError));
        }
    }
    child(context) {
        return new ChildProxyLogger(this.parent, this.merge(context));
    }
}
export const proxyLogger = new ProxyLogger();
