import { getEnvironmentVariable } from "./env.ts";
import { hasDenoRuntime, hasNodeProcess } from "../runtime-guards.ts";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export type LogFormat = "text" | "json";

/**
 * Structured log entry for JSON output.
 * Fields are designed for easy Grafana/Loki filtering.
 */
export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  message: string;
  // Optional structured context
  context?: Record<string, unknown>;
  // Error details if applicable
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  // Request context (when available)
  requestId?: string;
  traceId?: string;
  projectSlug?: string;
  // Standard fields for Loki filtering (snake_case for consistency)
  project_slug?: string;
  request_url?: string;
  domain?: string;
  project_id?: string;
  release_id?: string;
  branch_id?: string;
  branch_name?: string;
  // Duration for timed operations
  durationMs?: number;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Create a child logger with additional context bound to all log entries.
   */
  child(context: Record<string, unknown>): Logger;
}

type LoggerConfig = {
  level: LogLevel;
  format: LogFormat;
};

let cachedConfig: LoggerConfig | null = null;
let cachedEnvLevel: string | undefined;
let cachedDebugFlag: string | undefined;
let cachedEnvFormat: string | undefined;
let cachedEnvMode: string | undefined;

/**
 * Reset the cached logger configuration.
 * This is only intended for testing purposes to ensure fresh config evaluation.
 * @internal
 */
export function __resetLoggerConfigForTesting(): void {
  cachedConfig = null;
  cachedEnvLevel = undefined;
  cachedDebugFlag = undefined;
  cachedEnvFormat = undefined;
  cachedEnvMode = undefined;
}

function resolveLoggerConfig(): LoggerConfig {
  const envLevel = getEnvironmentVariable("LOG_LEVEL");
  const debugFlag = getEnvironmentVariable("VERYFRONT_DEBUG");
  const envFormat = getEnvironmentVariable("LOG_FORMAT");
  const envMode = getEnvironmentVariable("NODE_ENV");

  if (
    cachedConfig &&
    envLevel === cachedEnvLevel &&
    debugFlag === cachedDebugFlag &&
    envFormat === cachedEnvFormat &&
    envMode === cachedEnvMode
  ) {
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
function getDefaultFormat(
  envFormat: string | undefined = getEnvironmentVariable("LOG_FORMAT"),
  envMode: string | undefined = getEnvironmentVariable("NODE_ENV"),
): LogFormat {
  if (envFormat === "json" || envFormat === "text") return envFormat;
  return envMode === "production" ? "json" : "text";
}

/**
 * Serialize error object for structured logging.
 */
function serializeError(err: unknown): LogEntry["error"] | undefined {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (err == null) return undefined;
  return { name: "UnknownError", message: String(err) };
}

/**
 * Extract context from variadic args.
 * First object argument becomes context, errors are handled specially.
 */
function extractContext(
  args: unknown[],
): { context?: Record<string, unknown>; error?: LogEntry["error"] } {
  let context: Record<string, unknown> | undefined;
  let error: LogEntry["error"] | undefined;

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

const LEVEL_GLYPHS: Record<LogEntry["level"], string> = {
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

const TAG_COLORS: Record<string, string> = {
  CLI: ANSI.green,
  SERVER: ANSI.blue,
  RENDERER: ANSI.magenta,
  BUNDLER: ANSI.yellow,
  AGENT: ANSI.cyan,
  PROXY: ANSI.cyan,
  VERYFRONT: ANSI.cyan,
};

const LEVEL_COLORS: Record<LogEntry["level"], string> = {
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
    if (hasDenoRuntime(globalThis)) {
      return Boolean(globalThis.Deno?.stdout?.isTerminal?.());
    }
    if (hasNodeProcess(globalThis)) {
      return Boolean(
        (globalThis as unknown as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout
          ?.isTTY,
      );
    }
  } catch {
    return false;
  }
  return false;
}

function shouldUseColor(): boolean {
  const noColor = getEnvironmentVariable("NO_COLOR");
  const forceColor = getEnvironmentVariable("FORCE_COLOR");
  const logColor = getEnvironmentVariable("LOG_COLOR");

  if (forceColor === "0" || logColor === "0") return false;
  if (noColor !== undefined) return false;
  if (getEnvironmentVariable("CI") !== undefined) return false;
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
    return /\s/.test(trimmed) ? JSON.stringify(trimmed) : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }

  // JSON.stringify can return undefined for certain values (e.g., functions, symbols)
  if (text === undefined) return "undefined";
  return truncateText(normalizeText(text));
}

type SerializedError = NonNullable<LogEntry["error"]>;

function formatErrorText(error: SerializedError): string {
  return truncateText(normalizeText(`${error.name}: ${error.message}`), 120);
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

  const indent = " ".repeat(PREFIX_WIDTH);
  return `\n${indent}${colorize(entries.join(" "), ANSI.dim, enableColor)}`;
}

function extractToEntryField(
  entry: LogEntry,
  context: Record<string, unknown>,
  key: keyof LogEntry,
  coerce: (value: unknown) => LogEntry[keyof LogEntry],
): void {
  if (!(key in context)) return;
  (entry as unknown as Record<string, unknown>)[key] = coerce(
    (context as Record<string, unknown>)[key],
  );
  delete (context as Record<string, unknown>)[key];
}

class ConsoleLogger implements Logger {
  private boundContext: Record<string, unknown>;

  constructor(
    private prefix: string,
    boundContext?: Record<string, unknown>,
  ) {
    this.boundContext = boundContext ?? {};
  }

  child(context: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.prefix, { ...this.boundContext, ...context });
  }

  private formatJson(level: LogEntry["level"], message: string, args: unknown[]): string {
    const { context, error } = extractContext(args);
    const mergedContext: Record<string, unknown> = { ...this.boundContext, ...context };

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.prefix.toLowerCase(),
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

    if (Object.keys(mergedContext).length > 0) entry.context = mergedContext;
    if (error) entry.error = error;

    return JSON.stringify(entry);
  }

  private formatTextLine(level: LogEntry["level"], message: string, args: unknown[]): string {
    const { context, error } = extractContext(args);
    const mergedContext = { ...this.boundContext, ...context };
    const enableColor = shouldUseColor();

    const timestamp = colorize(formatTimestamp(), ANSI.dim, enableColor);
    const tag = colorize(padTag(this.prefix), TAG_COLORS[this.prefix] ?? ANSI.cyan, enableColor);
    const glyph = colorize(LEVEL_GLYPHS[level], LEVEL_COLORS[level], enableColor);
    const contextText = formatContextText(mergedContext, error, enableColor);

    return `${timestamp}  ${tag} ${glyph} ${message}${contextText}`;
  }

  private log(
    level: LogEntry["level"],
    logLevel: LogLevel,
    consoleFn: (...args: unknown[]) => void,
    message: string,
    args: unknown[],
  ): void {
    const { level: resolvedLevel, format: resolvedFormat } = resolveLoggerConfig();
    if (resolvedLevel > logLevel) return;

    const line = resolvedFormat === "json"
      ? this.formatJson(level, message, args)
      : this.formatTextLine(level, message, args);

    consoleFn(line);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log("debug", LogLevel.DEBUG, console.debug, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log("info", LogLevel.INFO, console.log, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log("warn", LogLevel.WARN, console.warn, message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log("error", LogLevel.ERROR, console.error, message, args);
  }

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = performance.now() - start;
      this.debug(`${label} completed`, { durationMs: Math.round(durationMs) });
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      this.error(`${label} failed`, { durationMs: Math.round(durationMs) }, error);
      throw error;
    }
  }
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  DEBUG: LogLevel.DEBUG,
  INFO: LogLevel.INFO,
  WARN: LogLevel.WARN,
  ERROR: LogLevel.ERROR,
};

function parseLogLevel(levelString: string | undefined): LogLevel | undefined {
  if (!levelString) return undefined;
  return LOG_LEVEL_MAP[levelString.toUpperCase()];
}

/**
 * Determine the log level based on environment variables.
 * Exported for testing purposes.
 * @internal
 */
export function getDefaultLevel(
  envLevel: string | undefined = getEnvironmentVariable("LOG_LEVEL"),
  debugFlag: string | undefined = getEnvironmentVariable("VERYFRONT_DEBUG"),
): LogLevel {
  const parsedLevel = parseLogLevel(envLevel);
  if (parsedLevel !== undefined) return parsedLevel;
  if (debugFlag === "1" || debugFlag === "true") return LogLevel.DEBUG;
  return LogLevel.INFO;
}

function createLogger(prefix: string): ConsoleLogger {
  return new ConsoleLogger(prefix);
}

export const cliLogger = createLogger("CLI");
export const serverLogger = createLogger("SERVER");
export const rendererLogger = createLogger("RENDERER");
export const bundlerLogger = createLogger("BUNDLER");
export const agentLogger = createLogger("AGENT");
export const proxyLogger = createLogger("PROXY");

export const logger = createLogger("VERYFRONT");

/**
 * Create a logger for a specific request context.
 * Useful for binding request-specific metadata to all logs.
 */
export function createRequestLogger(
  baseLogger: Logger,
  requestContext: {
    requestId?: string;
    traceId?: string;
    projectSlug?: string;
  },
): Logger {
  return baseLogger.child(requestContext);
}
