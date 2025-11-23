import { getEnvironmentVariable } from "./env.ts";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
}

const originalConsole = {
  debug: console.debug,
  log: console.log,
  warn: console.warn,
  error: console.error,
};

let cachedLogLevel: LogLevel | undefined;

function resolveLogLevel(force = false): LogLevel {
  if (force || cachedLogLevel === undefined) {
    cachedLogLevel = getDefaultLevel();
  }
  return cachedLogLevel;
}

class ConsoleLogger implements Logger {
  constructor(
    private prefix: string,
    private level: LogLevel = resolveLogLevel(),
  ) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[${this.prefix}] DEBUG: ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`[${this.prefix}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[${this.prefix}] WARN: ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[${this.prefix}] ERROR: ${message}`, ...args);
    }
  }

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const end = performance.now();
      this.debug(`${label} completed in ${(end - start).toFixed(2)}ms`);
      return result;
    } catch (_error) {
      const end = performance.now();
      this.error(`${label} failed after ${(end - start).toFixed(2)}ms`, _error);
      throw _error;
    }
  }
}

function parseLogLevel(levelString: string | undefined): LogLevel | undefined {
  if (!levelString) return undefined;
  const upper = levelString.toUpperCase();
  switch (upper) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    case "INFO":
      return LogLevel.INFO;
    default:
      return undefined;
  }
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

export const logger = createLogger("VERYFRONT");

type LoggerResetOptions = {
  restoreConsole?: boolean;
};

export function __loggerResetForTests(options: LoggerResetOptions = {}): void {
  const updatedLevel = resolveLogLevel(true);
  for (const instance of trackedLoggers) {
    instance.setLevel(updatedLevel);
  }

  if (options.restoreConsole) {
    console.debug = originalConsole.debug;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
}
