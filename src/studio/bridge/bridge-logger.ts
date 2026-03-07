/**
 * Bridge Logger
 *
 * Lightweight structured logger for browser-side bridge modules.
 * Wraps console methods with a consistent API matching the server-side
 * Logger interface (debug/info/warn/error with optional context).
 *
 * All output still goes through console.* so that bridge-console.ts
 * can intercept and forward it to Studio.
 */

interface BridgeLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

function formatArgs(message: string, context?: Record<string, unknown>): unknown[] {
  if (!context || Object.keys(context).length === 0) {
    return [message];
  }
  return [message, context];
}

export const logger: BridgeLogger = {
  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(...formatArgs(message, context));
  },
  info(message: string, context?: Record<string, unknown>): void {
    console.log(...formatArgs(message, context));
  },
  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(...formatArgs(message, context));
  },
  error(message: string, context?: Record<string, unknown>): void {
    console.error(...formatArgs(message, context));
  },
};
