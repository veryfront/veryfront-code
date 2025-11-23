export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface BrowserLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

class ConditionalBrowserLogger implements BrowserLogger {
  constructor(
    private prefix: string,
    private level: LogLevel,
  ) {}

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log?.(`[${this.prefix}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
    }
  }
}

interface VeryfrontWindow extends Window {
  __VERYFRONT_DEV__?: boolean;
  __RSC_DEV__?: boolean;
  __VERYFRONT_DEBUG__?: boolean;
  __RSC_DEBUG__?: boolean;
}

function getBrowserLogLevel(): LogLevel {
  if (typeof window === "undefined") {
    return LogLevel.WARN;
  }

  const windowObject = window as VeryfrontWindow;
  const isDevelopment = windowObject.__VERYFRONT_DEV__ || windowObject.__RSC_DEV__;

  if (!isDevelopment) {
    return LogLevel.WARN;
  }

  const isDebugEnabled = windowObject.__VERYFRONT_DEBUG__ || windowObject.__RSC_DEBUG__;
  return isDebugEnabled ? LogLevel.DEBUG : LogLevel.INFO;
}

const defaultLevel = getBrowserLogLevel();

export const rscLogger = new ConditionalBrowserLogger("RSC", defaultLevel);
export const prefetchLogger = new ConditionalBrowserLogger("PREFETCH", defaultLevel);
export const hydrateLogger = new ConditionalBrowserLogger("HYDRATE", defaultLevel);
export const browserLogger = new ConditionalBrowserLogger("VERYFRONT", defaultLevel);
