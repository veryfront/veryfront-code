import { getEnv } from "./env.ts";
import { getTraceContext } from "./tracing.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { PROXY_RUNTIME_VERSION } from "./version.ts";

// NOTE: Formatting utilities are INLINED below instead of imported from ../utils/logger/core.ts
// because the proxy Docker build only copies src/proxy/ and has no access to src/utils/.
// Keep these in sync with src/utils/logger/core.ts if changes are needed.

/**
 * Request context for proxy logging.
 * Stored in AsyncLocalStorage to propagate through the call stack.
 */
interface ProxyRequestContext {
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
function getProxyRequestContext(): ProxyRequestContext | undefined {
  return requestContextStore.getStore();
}

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

// ============================================================================
// INLINED FORMATTING UTILITIES (from src/utils/logger/core.ts)
// These must be kept in sync with core.ts but cannot be imported due to
// Docker build constraints (proxy is built independently).
// ============================================================================

const TAG_WIDTH = 10;
const PREFIX_WIDTH = 23; // timestamp(8) + gap(2) + tag(10) + space(1) + glyph(1) + space(1)

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
} as const;

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
    return /\s/.test(trimmed) ? JSON.stringify(trimmed) : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (_) {
    /* expected: non-serializable value */
    text = String(value);
  }

  if (text === undefined) return "undefined";
  return truncateText(normalizeText(text));
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

function formatErrorText(error: SerializedError | undefined): string {
  if (error == null) return "";

  const message = [error.name, error.message].join(": ");
  return truncateText(normalizeText(message), 120);
}

function serializeError(error: unknown): SerializedError | undefined {
  if (error == null) return undefined;

  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) serialized.stack = error.stack;
    return serialized;
  }

  return { name: "UnknownError", message: String(error) };
}

function formatContextText(
  context: Record<string, unknown>,
  error: SerializedError | undefined,
  enableColor: boolean,
): string {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    entries.push(`${key}=${formatValue(value)}`);
  }

  const errorText = formatErrorText(error);
  if (errorText) entries.push(`err=${errorText}`);
  if (entries.length === 0) return "";

  const coloredText = colorize(entries.join(" "), ANSI.dim, enableColor);
  return `\n${" ".repeat(PREFIX_WIDTH)}${coloredText}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ============================================================================
// END INLINED FORMATTING UTILITIES
// ============================================================================

function isTty(): boolean {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.stdout?.isTerminal === "function") {
      return Deno.stdout.isTerminal();
    }
  } catch (_) {
    // expected: TTY detection may be unavailable
  }

  const stdout = (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout;
  return stdout?.isTTY ?? false;
}

function shouldUseColor(): boolean {
  const env = {
    noColor: getEnv("NO_COLOR"),
    forceColor: getEnv("FORCE_COLOR"),
    logColor: getEnv("LOG_COLOR"),
    ci: getEnv("CI"),
  };

  if (env.forceColor === "0" || env.logColor === "0") return false;
  if (env.noColor !== undefined || env.ci !== undefined) return false;
  if (env.forceColor) return true;
  if (env.logColor === "1" || env.logColor === "true") return true;
  return isTty();
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
  error?: SerializedError;
}

function formatTextLine(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> | undefined,
  error: SerializedError | undefined,
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
      veryfrontVersion: PROXY_RUNTIME_VERSION,
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
