/******** Structured error handling with logging for silent failure operations */

// NOTE: serverLogger is imported but only accessed inside function bodies (never at
// module-eval time). This is safe even with circular deps because by the time any
// function in this module is called, all modules have finished initializing.
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { redactForSerialization } from "#veryfront/utils/logger/redact.ts";
import { sanitizeDiagnosticText, sanitizeStackDiagnosticText } from "./safe-diagnostics.ts";
import { getErrorMessage, isErrorInstance, snapshotError } from "./veryfront-error.ts";

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

function snapshotDiagnostic(error: unknown): {
  readonly message: string;
  readonly stack?: string;
} {
  const snapshot = snapshotError(error);
  if (snapshot) return snapshot;

  return {
    message: isErrorInstance(error) ? "Unknown error" : getErrorMessage(error),
  };
}

function snapshotContext(context: ErrorContext): ErrorContext {
  try {
    return {
      operation: sanitizeDiagnosticText(context.operation),
      path: context.path === undefined ? undefined : sanitizeDiagnosticText(context.path),
      slug: context.slug === undefined ? undefined : sanitizeDiagnosticText(context.slug),
      details: context.details,
    };
  } catch {
    return { operation: "unknown-operation" };
  }
}

function sanitizedDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {};
  const snapshot = redactForSerialization(details);
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : {};
}

function logErrorBestEffort(
  error: unknown,
  context: ErrorContext,
  logLevel: LogLevel = "debug",
  includeStack = false,
): void {
  try {
    const safeContext = snapshotContext(context);
    const diagnostic = snapshotDiagnostic(error);
    const message = sanitizeDiagnosticText(diagnostic.message);
    const logData: Record<string, unknown> = {
      ...sanitizedDetails(safeContext.details),
      path: safeContext.path,
      slug: safeContext.slug,
      errorMessage: message,
    };

    if (includeStack && diagnostic.stack) {
      logData.stack = sanitizeStackDiagnosticText(diagnostic.stack);
    }

    const logMessage = `[${safeContext.operation}] Silent failure: ${message}`;

    switch (logLevel) {
      case "error":
        serverLogger.error(logMessage, logData);
        return;
      case "warn":
        serverLogger.warn(logMessage, logData);
        return;
      default:
        serverLogger.debug(logMessage, logData);
    }
  } catch {
    // Logging is diagnostic only and must never replace the configured fallback.
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
    logErrorBestEffort(error, context, options.logLevel, options.includeStack);
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
    logErrorBestEffort(error, context, options.logLevel, options.includeStack);
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
    for await (const entry of adapter.fs.readDir(path)) results.push(entry);
    return results;
  } catch (error) {
    logErrorBestEffort(error, { operation, path }, "debug");
    return [];
  }
}

/** Create a scoped error context helper for multiple related operations */
export function createErrorScope(operationPrefix: string): {
  run<T>(
    operation: () => Promise<T>,
    details: Omit<ErrorContext, "operation">,
    fallback: T,
    logLevel?: LogLevel,
  ): Promise<T>;
  runSync<T>(
    operation: () => T,
    details: Omit<ErrorContext, "operation">,
    fallback: T,
    logLevel?: LogLevel,
  ): T;
} {
  function buildContext(details: Omit<ErrorContext, "operation">): ErrorContext {
    try {
      return {
        operation: operationPrefix,
        path: details.path,
        slug: details.slug,
        details: details.details,
      };
    } catch {
      return { operation: operationPrefix };
    }
  }

  return {
    run<T>(
      operation: () => Promise<T>,
      details: Omit<ErrorContext, "operation">,
      fallback: T,
      logLevel: LogLevel = "debug",
    ): Promise<T> {
      return withErrorContext(operation, buildContext(details), { fallback, logLevel });
    },

    runSync<T>(
      operation: () => T,
      details: Omit<ErrorContext, "operation">,
      fallback: T,
      logLevel: LogLevel = "debug",
    ): T {
      return withErrorContextSync(operation, buildContext(details), { fallback, logLevel });
    },
  };
}
