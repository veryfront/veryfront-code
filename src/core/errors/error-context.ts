/**
 * Error Context Utilities
 *
 * Provides structured error handling with logging for operations that
 * may fail silently. Helps debug production issues by logging context
 * even when errors are caught and handled.
 */

import { serverLogger } from "@veryfront/utils/logger/logger.ts";

/**
 * Context information for error logging
 */
export interface ErrorContext {
  operation: string;
  path?: string;
  slug?: string;
  details?: Record<string, unknown>;
}

/**
 * Log level for error context logging
 */
export type LogLevel = "debug" | "warn" | "error";

/**
 * Options for error handling behavior
 */
export interface ErrorHandlingOptions<T> {
  /** Default value to return on error */
  fallback: T;
  /** Log level for error messages */
  logLevel?: LogLevel;
  /** Whether to include stack trace in logs */
  includeStack?: boolean;
}

/**
 * Extract error message from unknown error
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Extract stack trace from error if available
 */
function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

/**
 * Log an error with context information
 */
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

  switch (logLevel) {
    case "error":
      serverLogger.error(logMessage, logData);
      break;
    case "warn":
      serverLogger.warn(logMessage, logData);
      break;
    case "debug":
    default:
      serverLogger.debug(logMessage, logData);
      break;
  }
}

/**
 * Execute an async operation with error logging and fallback.
 * Use this to wrap operations that may fail but shouldn't throw.
 *
 * @example
 * ```ts
 * const stat = await withErrorContext(
 *   () => adapter.fs.stat(path),
 *   { operation: "stat-file", path },
 *   { fallback: null }
 * );
 * ```
 */
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

/**
 * Execute a sync operation with error logging and fallback.
 */
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

/**
 * Type-safe wrapper for file stat operations with logging
 */
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

/**
 * Type-safe wrapper for file read operations with logging
 */
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

/**
 * Type-safe wrapper for directory read operations with logging
 */
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

/**
 * Create a scoped error context helper for a specific operation.
 * Useful when performing multiple related operations.
 *
 * @example
 * ```ts
 * const ctx = createErrorScope("resolve-page");
 * const stat = await ctx.run(() => adapter.fs.stat(path), { path }, null);
 * ```
 */
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
