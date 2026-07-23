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

import { snapshotStudioValue } from "./bridge-messaging.ts";

type LogContext = Record<string, unknown> | Error;

const MAX_LOG_MESSAGE_LENGTH = 4_096;

interface BridgeLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

function normalizeContext(context?: LogContext): Record<string, unknown> | undefined {
  if (!context) return undefined;
  try {
    if (context instanceof Error) {
      const descriptor = Object.getOwnPropertyDescriptor(context, "message");
      return {
        error: descriptor && !descriptor.get && !descriptor.set &&
            typeof descriptor.value === "string"
          ? descriptor.value.slice(0, MAX_LOG_MESSAGE_LENGTH)
          : "Bridge operation failed",
      };
    }
  } catch {
    return { error: "Bridge operation failed" };
  }
  const snapshot = snapshotStudioValue(context);
  return snapshot?.value && typeof snapshot.value === "object" && !Array.isArray(snapshot.value)
    ? snapshot.value as Record<string, unknown>
    : { error: "Bridge log context unavailable" };
}

function formatArgs(message: string, context?: LogContext): unknown[] {
  const normalized = normalizeContext(context);
  const boundedMessage = message.slice(0, MAX_LOG_MESSAGE_LENGTH);
  return normalized ? [boundedMessage, normalized] : [boundedMessage];
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
