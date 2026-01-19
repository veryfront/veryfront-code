/** Structured error handling with logging for silent failure operations */

import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getErrorMessage } from "./veryfront-error.ts";

export interface ErrorContext {
  operation: string;
  path?: string;
  slug?: string;
  details?: Record<string, unknown>;
}

export type LogLevel = "debug" | "warn" | "error";

export interface ErrorHandlingOptions<T> {
  /** Default value to return on error */
  fallback: T;
  /** Log level for error messages */
  logLevel?: LogLevel;
  /** Whether to include stack trace in logs */
  includeStack?: boolean;
}

function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

function logError(
  error: unknown,
  context: ErrorContext,
  logLevel: LogLevel = "debug",
  includeStack = false,
): void {
  const message = getErrorMessage(error);
  const logData: Record<string, unknown> = {
    ...context.details,
    path: context.path,
    slug: context.slug,
    errorMessage: message,
  };

  if (includeStack) {
    const stack = getErrorStack(error);
    if (stack) {
      logData.stack = stack;
    }
  }

  const logMessage = `[${context.operation}] Silent failure: ${message}`;

  if (logLevel === "error") {
    serverLogger.error(logMessage, logData);
  } else if (logLevel === "warn") {
    serverLogger.warn(logMessage, logData);
  } else {
    serverLogger.debug(logMessage, logData);
  }
}

/** Execute async operation with error logging and fallback */
export async function withErrorContext<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  options: ErrorHandlingOptions<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logError(error, context, options.logLevel, options.includeStack);
    return options.fallback;
  }
}

/** Execute sync operation with error logging and fallback */
export function withErrorContextSync<T>(
  operation: () => T,
  context: ErrorContext,
  options: ErrorHandlingOptions<T>,
): T {
  try {
    return operation();
  } catch (error) {
    logError(error, context, options.logLevel, options.includeStack);
    return options.fallback;
  }
}

/** Safe file stat with logging */
export function safeFileStat(
  adapter: { fs: { stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean }> } },
  path: string,
  operation: string,
): Promise<{ isFile: boolean; isDirectory: boolean } | null> {
  return withErrorContext(
    () => adapter.fs.stat(path),
    { operation, path },
    { fallback: null, logLevel: "debug" },
  );
}

/** Safe file read with logging */
export function safeFileRead(
  adapter: { fs: { readFile: (path: string) => Promise<string> } },
  path: string,
  operation: string,
): Promise<string | null> {
  return withErrorContext(
    () => adapter.fs.readFile(path),
    { operation, path },
    { fallback: null, logLevel: "debug" },
  );
}

/** Safe directory read with logging */
export async function safeReadDir<T>(
  adapter: { fs: { readDir: (path: string) => AsyncIterable<T> } },
  path: string,
  operation: string,
): Promise<T[]> {
  try {
    const results: T[] = [];
    for await (const entry of adapter.fs.readDir(path)) {
      results.push(entry);
    }
    return results;
  } catch (error) {
    logError(error, { operation, path }, "debug");
    return [];
  }
}

/** Create a scoped error context helper for multiple related operations */
export function createErrorScope(operationPrefix: string) {
  return {
    run<T>(
      operation: () => Promise<T>,
      details: Omit<ErrorContext, "operation">,
      fallback: T,
      logLevel: LogLevel = "debug",
    ): Promise<T> {
      return withErrorContext(
        operation,
        { operation: operationPrefix, ...details },
        { fallback, logLevel },
      );
    },

    runSync<T>(
      operation: () => T,
      details: Omit<ErrorContext, "operation">,
      fallback: T,
      logLevel: LogLevel = "debug",
    ): T {
      return withErrorContextSync(
        operation,
        { operation: operationPrefix, ...details },
        { fallback, logLevel },
      );
    },
  };
}
