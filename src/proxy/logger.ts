// Inline cross-runtime getEnv to avoid dependency on src/platform/compat (not copied in Docker)
function getEnv(key: string): string | undefined {
  // Deno
  if (typeof Deno !== "undefined" && Deno.env?.get) {
    return Deno.env.get(key);
  }
  // Node.js / Bun
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
  return nodeProcess?.env?.[key];
}

// Import version from root deno.json (the source of truth)
import denoConfig from "../../deno.json" with { type: "json" };
import { getTraceContext } from "./tracing.ts";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request context for proxy logging.
 * Stored in AsyncLocalStorage to propagate through the call stack.
 */
export interface ProxyRequestContext {
  requestId: string;
  projectSlug?: string;
  projectId?: string;
  releaseId?: string;
  branchId?: string;
  branchName?: string;
  domain?: string;
  environment?: string;
}

const requestContextStore = new AsyncLocalStorage<ProxyRequestContext>();

/**
 * Run a function with proxy request context.
 * All logs within the function will include the request context fields.
 */
export function runWithProxyRequestContext<T>(
  context: ProxyRequestContext,
  fn: () => T,
): T {
  return requestContextStore.run(context, fn);
}

/**
 * Get the current proxy request context (if any).
 */
export function getProxyRequestContext(): ProxyRequestContext | undefined {
  return requestContextStore.getStore();
}

// Get version from environment variable or root deno.json
const VERYFRONT_VERSION: string = getEnv("VERYFRONT_VERSION") ??
  (typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0");

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Log level configuration
const MIN_LOG_LEVEL: LogLevel = (() => {
  const level = getEnv("LOG_LEVEL")?.toLowerCase();
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info"; // Default: suppress debug logs
})();

const TAG_WIDTH = 10;

const LEVEL_GLYPHS: Record<LogLevel, string> = {
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

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: ANSI.gray,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
};

function padTag(tag: string): string {
  if (tag.length >= TAG_WIDTH) return tag.slice(0, TAG_WIDTH);
  return tag.padEnd(TAG_WIDTH, " ");
}

function formatTimestamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function isTty(): boolean {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.stdout?.isTerminal === "function") {
      return Deno.stdout.isTerminal();
    }
  } catch {
    // ignore
  }

  const stdout = (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout;
  return stdout?.isTTY ?? false;
}

function shouldUseColor(): boolean {
  const noColor = getEnv("NO_COLOR");
  const forceColor = getEnv("FORCE_COLOR");
  const logColor = getEnv("LOG_COLOR");

  if (forceColor === "0" || logColor === "0") return false;
  if (noColor !== undefined) return false;
  if (getEnv("CI") !== undefined) return false;
  if (forceColor || logColor === "1" || logColor === "true") return true;

  return isTty();
}

function colorize(text: string, color: string | undefined, enable: boolean): string {
  if (!enable || !color) return text;
  return `${color}${text}${ANSI.reset}`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ");
}

function truncateText(value: string, maxLength = 80): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = normalizeText(value);
    if (/\s/.test(trimmed)) return JSON.stringify(trimmed);
    return trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }

  return truncateText(normalizeText(text));
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  veryfrontVersion: string;
  message: string;
  traceId?: string;
  spanId?: string;
  // Request context fields (at top level for Grafana filtering)
  requestId?: string;
  projectSlug?: string;
  projectId?: string;
  releaseId?: string;
  branchId?: string;
  branchName?: string;
  domain?: string;
  environment?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

function formatErrorText(error: LogEntry["error"]): string {
  if (!error) return "";
  const text = `${error.name}: ${error.message}`;
  return truncateText(normalizeText(text), 120);
}

// Prefix width: timestamp(8) + gap(2) + tag(10) + space(1) + glyph(1) + space(1) = 23
const PREFIX_WIDTH = 23;

function formatContextText(
  context: Record<string, unknown>,
  error: LogEntry["error"] | undefined,
  enableColor: boolean,
): string {
  const entries = Object.entries(context).map(([key, value]) => `${key}=${formatValue(value)}`);
  if (error) entries.push(`err=${formatErrorText(error)}`);
  if (entries.length === 0) return "";

  const text = entries.join(" ");
  // Put context on new line, indented to align with message
  const indent = " ".repeat(PREFIX_WIDTH);
  return `\n${indent}${colorize(text, ANSI.dim, enableColor)}`;
}

function formatTextLine(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> | undefined,
  error: LogEntry["error"] | undefined,
): string {
  const enableColor = shouldUseColor();
  const timestamp = colorize(formatTimestamp(), ANSI.dim, enableColor);
  const tag = colorize(padTag("PROXY"), ANSI.cyan, enableColor);
  const glyph = colorize(LEVEL_GLYPHS[level], LEVEL_COLORS[level], enableColor);
  const contextText = formatContextText(context ?? {}, error, enableColor);
  return `${timestamp}  ${tag} ${glyph} ${message}${contextText}`;
}

function isProduction(): boolean {
  return getEnv("NODE_ENV") === "production";
}

function getLogFormat(): "json" | "text" {
  const format = getEnv("LOG_FORMAT");
  if (format === "json" || format === "text") return format;
  return isProduction() ? "json" : "text";
}

function serializeError(err: unknown): LogEntry["error"] | undefined {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (err !== undefined && err !== null) {
    return { name: "UnknownError", message: String(err) };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ProxyLogger {
  private format = getLogFormat();

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[MIN_LOG_LEVEL]) return;

    if (this.format !== "json") {
      console.log(formatTextLine(level, message, context, serializeError(error)));
      return;
    }

    const traceCtx = getTraceContext();
    const reqCtx = getProxyRequestContext();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: "proxy",
      veryfrontVersion: VERYFRONT_VERSION,
      message,
      ...(traceCtx.traceId && { traceId: traceCtx.traceId, spanId: traceCtx.spanId }),
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

    if (context && Object.keys(context).length > 0) entry.context = context;

    const serializedError = serializeError(error);
    if (serializedError) entry.error = serializedError;

    console.log(JSON.stringify(entry));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: unknown): void;
  error(message: string, context: Record<string, unknown>, error?: unknown): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (error !== undefined) {
      this.log("error", message, contextOrError as Record<string, unknown>, error);
      return;
    }

    if (contextOrError instanceof Error) {
      this.log("error", message, undefined, contextOrError);
      return;
    }

    this.log("error", message, contextOrError as Record<string, unknown>);
  }

  /**
   * Create a child logger with bound context.
   */
  child(context: Record<string, unknown>): ChildProxyLogger {
    return new ChildProxyLogger(this, context);
  }
}

class ChildProxyLogger {
  constructor(
    private parent: ProxyLogger,
    private boundContext: Record<string, unknown>,
  ) {}

  private merge(ctx?: Record<string, unknown>): Record<string, unknown> {
    return { ...this.boundContext, ...ctx };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.merge(context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, this.merge(context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, this.merge(context));
  }

  error(message: string, error?: unknown): void;
  error(message: string, context: Record<string, unknown>, error?: unknown): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (error !== undefined) {
      this.parent.error(message, this.merge(contextOrError as Record<string, unknown>), error);
      return;
    }

    if (contextOrError instanceof Error) {
      this.parent.error(message, this.boundContext, contextOrError);
      return;
    }

    if (isRecord(contextOrError)) {
      this.parent.error(message, this.merge(contextOrError));
      return;
    }

    this.parent.error(message, this.merge(contextOrError as Record<string, unknown>));
  }

  child(context: Record<string, unknown>): ChildProxyLogger {
    return new ChildProxyLogger(this.parent, this.merge(context));
  }
}

export const proxyLogger = new ProxyLogger();
