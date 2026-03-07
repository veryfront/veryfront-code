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

type LogContext = Record<string, unknown> | Error;

interface BridgeLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

function normalizeContext(context?: LogContext): Record<string, unknown> | undefined {
  if (!context) return undefined;
  if (context instanceof Error) {
    return { error: context.message, ...(context.stack ? { stack: context.stack } : {}) };
  }
  return context;
}

function formatArgs(message: string, context?: LogContext): unknown[] {
  const normalized = normalizeContext(context);
  if (!normalized || Object.keys(normalized).length === 0) {
    return [message];
  }
  return [message, normalized];
}

export const logger: BridgeLogger = {
  debug(message: string, context?: LogContext): void {
    console.debug(...formatArgs(message, context));
  },
  info(message: string, context?: LogContext): void {
    console.log(...formatArgs(message, context));
  },
  warn(message: string, context?: LogContext): void {
    console.warn(...formatArgs(message, context));
  },
  error(message: string, context?: LogContext): void {
    console.error(...formatArgs(message, context));
  },
};
