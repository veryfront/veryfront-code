// Inline getEnv to avoid dependency on src/platform/compat (not copied in Docker)
function getEnv(key: string): string | undefined {
  return Deno.env.get(key);
}
import { getTraceContext } from "./tracing.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

// Log level configuration
const MIN_LOG_LEVEL: LogLevel = ((): LogLevel => {
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
  let text = "";
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return truncateText(normalizeText(text));
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
  if (error) {
    entries.push(`err=${formatErrorText(error)}`);
  }
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

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  traceId?: string;
  spanId?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

function isProduction(): boolean {
  return getEnv("NODE_ENV") === "production";
}

function getLogFormat(): "json" | "text" {
  const format = getEnv("LOG_FORMAT");
  if (format === "json" || format === "text") return format;
  return isProduction() ? "json" : "text";
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function serializeError(err: unknown): LogEntry["error"] | undefined {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (err !== undefined && err !== null) {
    return { name: "UnknownError", message: String(err) };
  }
  return undefined;
}

class ProxyLogger {
  private format = getLogFormat();

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void {
    // Filter by minimum log level
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[MIN_LOG_LEVEL]) {
      return;
    }
    if (this.format === "json") {
      const traceCtx = getTraceContext();
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        service: "proxy",
        message,
        ...(traceCtx.traceId && { traceId: traceCtx.traceId, spanId: traceCtx.spanId }),
      };
      if (context && Object.keys(context).length > 0) {
        entry.context = context;
      }
      const serializedError = serializeError(error);
      if (serializedError) {
        entry.error = serializedError;
      }
      console.log(JSON.stringify(entry));
    } else {
      const serializedError = serializeError(error);
      console.log(formatTextLine(level, message, context, serializedError));
    }
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
  error(
    message: string,
    context: Record<string, unknown>,
    error?: unknown,
  ): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (contextOrError instanceof Error || error !== undefined) {
      const ctx = contextOrError instanceof Error
        ? undefined
        : contextOrError as Record<string, unknown>;
      const err = contextOrError instanceof Error ? contextOrError : error;
      this.log("error", message, ctx, err);
    } else {
      this.log("error", message, contextOrError as Record<string, unknown>);
    }
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
  error(
    message: string,
    context: Record<string, unknown>,
    error?: unknown,
  ): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (contextOrError instanceof Error || error !== undefined) {
      const ctx = contextOrError instanceof Error
        ? this.boundContext
        : this.merge(contextOrError as Record<string, unknown>);
      const err = contextOrError instanceof Error ? contextOrError : error;
      this.parent.error(message, ctx, err);
    } else {
      this.parent.error(
        message,
        this.merge(contextOrError as Record<string, unknown>),
      );
    }
  }

  child(context: Record<string, unknown>): ChildProxyLogger {
    return new ChildProxyLogger(this.parent, this.merge(context));
  }
}

export const proxyLogger = new ProxyLogger();
