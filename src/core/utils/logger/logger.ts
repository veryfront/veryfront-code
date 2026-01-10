import { getEnvironmentVariable, isProductionEnvironment } from "./env.ts";

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

const originalConsole = {
  debug: console.debug,
  log: console.log,
  warn: console.warn,
  error: console.error,
};

let cachedLogLevel: LogLevel | undefined;
let cachedLogFormat: LogFormat | undefined;

function resolveLogLevel(force = false): LogLevel {
  if (force || cachedLogLevel === undefined) {
    cachedLogLevel = getDefaultLevel();
  }
  return cachedLogLevel;
}

function resolveLogFormat(force = false): LogFormat {
  if (force || cachedLogFormat === undefined) {
    cachedLogFormat = getDefaultFormat();
  }
  return cachedLogFormat;
}

/**
 * Determine log format from environment.
 * Defaults to JSON in production for Grafana compatibility.
 */
function getDefaultFormat(): LogFormat {
  const envFormat = getEnvironmentVariable("LOG_FORMAT");
  if (envFormat === "json" || envFormat === "text") {
    return envFormat;
  }
  // Default to JSON in production for structured logging
  return isProductionEnvironment() ? "json" : "text";
}

/**
 * Serialize error object for structured logging.
 */
function serializeError(err: unknown): LogEntry["error"] | undefined {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (err != null) {
    return {
      name: "UnknownError",
      message: String(err),
    };
  }
  return undefined;
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
    } else if (typeof arg === "object" && arg !== null && !Array.isArray(arg)) {
      context = { ...context, ...(arg as Record<string, unknown>) };
    }
  }

  return { context, error };
}

class ConsoleLogger implements Logger {
  private boundContext: Record<string, unknown> = {};

  constructor(
    private prefix: string,
    private level: LogLevel = resolveLogLevel(),
    private format: LogFormat = resolveLogFormat(),
    boundContext?: Record<string, unknown>,
  ) {
    this.boundContext = boundContext ?? {};
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setFormat(format: LogFormat): void {
    this.format = format;
  }

  getFormat(): LogFormat {
    return this.format;
  }

  /**
   * Create a child logger with additional bound context.
   */
  child(context: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.prefix, this.level, this.format, {
      ...this.boundContext,
      ...context,
    });
  }

  private formatJson(
    level: LogEntry["level"],
    message: string,
    args: unknown[],
  ): string {
    const { context, error } = extractContext(args);
    const mergedContext = { ...this.boundContext, ...context };

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.prefix.toLowerCase(),
      message,
    };

    // Extract known fields to top level for easier Grafana filtering
    if ("requestId" in mergedContext) {
      entry.requestId = String(mergedContext.requestId);
      delete mergedContext.requestId;
    }
    if ("traceId" in mergedContext) {
      entry.traceId = String(mergedContext.traceId);
      delete mergedContext.traceId;
    }
    if ("projectSlug" in mergedContext) {
      entry.projectSlug = String(mergedContext.projectSlug);
      delete mergedContext.projectSlug;
    }
    if ("durationMs" in mergedContext) {
      entry.durationMs = Number(mergedContext.durationMs);
      delete mergedContext.durationMs;
    }

    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }

    if (error) {
      entry.error = error;
    }

    return JSON.stringify(entry);
  }

  private log(
    level: LogEntry["level"],
    logLevel: LogLevel,
    consoleFn: (...args: unknown[]) => void,
    message: string,
    args: unknown[],
  ): void {
    if (this.level > logLevel) return;

    if (this.format === "json") {
      consoleFn(this.formatJson(level, message, args));
    } else {
      const prefix = level === "info" ? "" : ` ${level.toUpperCase()}:`;
      consoleFn(`[${this.prefix}]${prefix} ${message}`, ...args);
    }
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

const getDefaultLevel = (): LogLevel => {
  const envLevel = getEnvironmentVariable("LOG_LEVEL");
  const parsedLevel = parseLogLevel(envLevel);
  if (parsedLevel !== undefined) return parsedLevel;

  const debugFlag = getEnvironmentVariable("VERYFRONT_DEBUG");
  if (debugFlag === "1" || debugFlag === "true") return LogLevel.DEBUG;

  return LogLevel.INFO;
};

const trackedLoggers = new Set<ConsoleLogger>();

function createLogger(prefix: string): ConsoleLogger {
  const logger = new ConsoleLogger(prefix);
  trackedLoggers.add(logger);
  return logger;
}

export const cliLogger = createLogger("CLI");
export const serverLogger = createLogger("SERVER");
export const rendererLogger = createLogger("RENDERER");
export const bundlerLogger = createLogger("BUNDLER");
export const agentLogger = createLogger("AGENT");
export const proxyLogger = createLogger("PROXY");

export const logger = createLogger("VERYFRONT");

type LoggerResetOptions = {
  restoreConsole?: boolean;
};

export function __loggerResetForTests(options: LoggerResetOptions = {}): void {
  const updatedLevel = resolveLogLevel(true);
  const updatedFormat = resolveLogFormat(true);
  for (const instance of trackedLoggers) {
    instance.setLevel(updatedLevel);
    instance.setFormat(updatedFormat);
  }

  if (options.restoreConsole) {
    console.debug = originalConsole.debug;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
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
