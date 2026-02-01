import { getEnv } from "#veryfront/platform/compat/process.ts";
import { hasDenoRuntime, hasNodeProcess } from "../runtime-guards.ts";
import { VERSION } from "../version.ts";
import {
  ANSI,
  colorize,
  formatContextText,
  formatTimestamp,
  LEVEL_COLORS,
  LEVEL_GLYPHS,
  type LogLevelName,
  padTag,
  type SerializedError,
  serializeError,
} from "./core.ts";

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
  level: LogLevelName;
  service: string;
  veryfrontVersion: string;
  message: string;
  // Optional structured context
  context?: Record<string, unknown>;
  // Error details if applicable
  error?: SerializedError;
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
export function __resetLoggerConfigForTests(): void {
  cachedConfig = null;
  cachedEnvLevel = undefined;
  cachedDebugFlag = undefined;
  cachedEnvFormat = undefined;
  cachedEnvMode = undefined;
}

function resolveLoggerConfig(): LoggerConfig {
  const envLevel = getEnv("LOG_LEVEL");
  const debugFlag = getEnv("VERYFRONT_DEBUG");
  const envFormat = getEnv("LOG_FORMAT");
  const envMode = getEnv("NODE_ENV");

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
  envFormat: string | undefined = getEnv("LOG_FORMAT"),
  envMode: string | undefined = getEnv("NODE_ENV"),
): LogFormat {
  if (envFormat === "json" || envFormat === "text") return envFormat;
  return envMode === "production" ? "json" : "text";
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

const TAG_COLORS: Record<string, string> = {
  CLI: ANSI.green,
  SERVER: ANSI.blue,
  RENDERER: ANSI.magenta,
  BUNDLER: ANSI.yellow,
  AGENT: ANSI.cyan,
  PROXY: ANSI.cyan,
  VERYFRONT: ANSI.cyan,
};

function isTty(): boolean {
  try {
    if (hasDenoRuntime(globalThis)) {
      return Boolean(globalThis.Deno?.stdout?.isTerminal?.());
    }
    if (hasNodeProcess(globalThis)) {
      return Boolean(globalThis.process?.stdout?.isTTY);
    }
  } catch {
    return false;
  }
  return false;
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

function extractToEntryField(
  entry: LogEntry,
  context: Record<string, unknown>,
  key: keyof LogEntry,
  coerce: (value: unknown) => LogEntry[keyof LogEntry],
): void {
  if (!(key in context)) return;
  entry[key] = coerce(context[key]) as never;
  delete context[key];
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
  envLevel: string | undefined = getEnv("LOG_LEVEL"),
  debugFlag: string | undefined = getEnv("VERYFRONT_DEBUG"),
): LogLevel {
  const parsedLevel = parseLogLevel(envLevel);
  if (parsedLevel !== undefined) return parsedLevel;
  if (debugFlag === "1" || debugFlag === "true") return LogLevel.DEBUG;
  return LogLevel.INFO;
}

function createLogger(prefix: string): ConsoleLogger {
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
let requestContextGetter: (() => { logger: Logger } | undefined) | null = null;

/**
 * Register the request context getter.
 * Called by request-context.ts during module initialization.
 * @internal
 */
export function __registerRequestContextGetter(
  getter: () => { logger: Logger } | undefined,
): void {
  requestContextGetter = getter;
}

function withRequestLogger(base: Logger): Logger {
  const ctx = requestContextGetter?.();
  return ctx?.logger ?? base;
}

/**
 * Create a context-aware logger proxy that automatically uses
 * request-scoped context from AsyncLocalStorage when available.
 */
function createContextAwareLogger(base: ConsoleLogger): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      withRequestLogger(base).debug(message, ...args);
    },
    info(message: string, ...args: unknown[]): void {
      withRequestLogger(base).info(message, ...args);
    },
    warn(message: string, ...args: unknown[]): void {
      withRequestLogger(base).warn(message, ...args);
    },
    error(message: string, ...args: unknown[]): void {
      withRequestLogger(base).error(message, ...args);
    },
    time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      return withRequestLogger(base).time(label, fn);
    },
    child(context: Record<string, unknown>): Logger {
      return withRequestLogger(base).child(context);
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
export function getBaseLogger(prefix: string): ConsoleLogger {
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
