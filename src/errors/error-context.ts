/******** Structured error handling with logging for silent failure operations */

// NOTE: serverLogger is imported but only accessed inside function bodies (never at
// module-eval time). This is safe even with circular deps because by the time any
// function in this module is called, all modules have finished initializing.
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeErrorContext, sanitizeErrorText } from "./sanitization.ts";
import { hasUnsafeControlCharacters } from "./text-validation.ts";

/** Stable context attached to an explicit fallback operation. */
export interface ErrorContext {
  /** Low-cardinality operation name. */
  operation: string;
  /** Optional local path, redacted before logging. */
  path?: string;
  /** Optional registered error slug. */
  slug?: string;
  /** Additional structured details, sanitized before logging. */
  details?: Record<string, unknown>;
}

/** Severity used for fallback-operation logs. */
export type LogLevel = "debug" | "warn" | "error";

/** Controls explicit fallback behavior and its diagnostic severity. */
export interface ErrorHandlingOptions<T> {
  /** Default value to return on error */
  fallback: T;
  /** Log level for error messages */
  logLevel?: LogLevel;
  /**
   * Legacy request to include a stack trace.
   *
   * @deprecated Stack traces are omitted from fallback logs to avoid disclosing local paths.
   */
  includeStack?: boolean;
}

interface ErrorHandlingSnapshot<T> {
  fallback: T;
  logLevel: LogLevel;
  includeStack: boolean;
}

function snapshotHandlingOptions<T>(options: ErrorHandlingOptions<T>): ErrorHandlingSnapshot<T> {
  try {
    if (!options || typeof options !== "object") throw new TypeError();
    const fallback = options.fallback;
    const logLevel = options.logLevel ?? "debug";
    const includeStack = options.includeStack ?? false;
    if (logLevel !== "debug" && logLevel !== "warn" && logLevel !== "error") {
      throw new TypeError();
    }
    if (typeof includeStack !== "boolean") throw new TypeError();
    return { fallback, logLevel, includeStack };
  } catch {
    throw new TypeError("Invalid error handling options");
  }
}

function snapshotErrorContext(context: ErrorContext): ErrorContext {
  try {
    if (!context || typeof context !== "object") throw new TypeError();
    const operation = context.operation;
    const path = context.path;
    const slug = context.slug;
    const details = context.details;
    if (
      typeof operation !== "string" || operation.trim().length === 0 ||
      operation.length > 256 || hasUnsafeControlCharacters(operation)
    ) {
      throw new TypeError();
    }
    if (
      path !== undefined &&
      (typeof path !== "string" || path.length > 4_096 || hasUnsafeControlCharacters(path))
    ) throw new TypeError();
    if (
      slug !== undefined &&
      (typeof slug !== "string" || slug.trim().length === 0 || slug.length > 128 ||
        hasUnsafeControlCharacters(slug))
    ) throw new TypeError();
    if (
      details !== undefined &&
      (!details || typeof details !== "object" || Array.isArray(details))
    ) throw new TypeError();
    return {
      operation: sanitizeErrorText(operation, 256),
      path,
      slug: slug === undefined ? undefined : sanitizeErrorText(slug, 128),
      details: sanitizeErrorContext(details),
    };
  } catch {
    throw new TypeError("Invalid error context");
  }
}

function assertOperation(value: unknown): asserts value is () => unknown {
  if (typeof value !== "function") throw new TypeError("operation must be a function");
}

function logError(
  error: unknown,
  context: ErrorContext,
  logLevel: LogLevel = "debug",
  includeStack = false,
): void {
  void error;
  void includeStack;
  try {
    const operation = sanitizeErrorText(context.operation, 256);
    const logData = sanitizeErrorContext({
      ...(sanitizeErrorContext(context.details) ?? {}),
      path: context.path,
      slug: context.slug,
    });
    const logMessage = `[${operation}] Operation failed; using configured fallback`;

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
    // Error reporting must not replace the configured fallback behavior.
  }
}

/** Execute async operation with error logging and fallback */
export async function withErrorContext<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  options: ErrorHandlingOptions<T>,
): Promise<T> {
  assertOperation(operation);
  const snapshot = snapshotHandlingOptions(options);
  const contextSnapshot = snapshotErrorContext(context);
  try {
    return await operation();
  } catch (error) {
    logError(error, contextSnapshot, snapshot.logLevel, snapshot.includeStack);
    return snapshot.fallback;
  }
}

/** Execute sync operation with error logging and fallback */
export function withErrorContextSync<T>(
  operation: () => T,
  context: ErrorContext,
  options: ErrorHandlingOptions<T>,
): T {
  assertOperation(operation);
  const snapshot = snapshotHandlingOptions(options);
  const contextSnapshot = snapshotErrorContext(context);
  try {
    return operation();
  } catch (error) {
    logError(error, contextSnapshot, snapshot.logLevel, snapshot.includeStack);
    return snapshot.fallback;
  }
}

/** Safe file stat with logging */
export async function safeFileStat(
  adapter: { fs: { stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean }> } },
  path: string,
  operation: string,
): Promise<{ isFile: boolean; isDirectory: boolean } | null> {
  const context = snapshotErrorContext({ operation, path });
  const stat = snapshotFsMethod<Promise<{ isFile: boolean; isDirectory: boolean }>>(
    adapter,
    "stat",
  );
  return await withErrorContext(
    () => stat(path),
    context,
    { fallback: null, logLevel: "debug" },
  );
}

/** Safe file read with logging */
export async function safeFileRead(
  adapter: { fs: { readFile: (path: string) => Promise<string> } },
  path: string,
  operation: string,
): Promise<string | null> {
  const context = snapshotErrorContext({ operation, path });
  const readFile = snapshotFsMethod<Promise<string>>(adapter, "readFile");
  return await withErrorContext(
    () => readFile(path),
    context,
    { fallback: null, logLevel: "debug" },
  );
}

/** Safe directory read with logging */
export async function safeReadDir<T>(
  adapter: { fs: { readDir: (path: string) => AsyncIterable<T> } },
  path: string,
  operation: string,
): Promise<T[]> {
  const context = snapshotErrorContext({ operation, path });
  const readDir = snapshotFsMethod<AsyncIterable<T>>(adapter, "readDir");
  return await withErrorContext(
    async () => {
      const results: T[] = [];
      for await (const entry of readDir(path)) results.push(entry);
      return results;
    },
    context,
    { fallback: [], logLevel: "debug" },
  );
}

function snapshotFsMethod<TResult>(
  adapter: unknown,
  methodName: string,
): (path: string) => TResult {
  try {
    if (!adapter || typeof adapter !== "object") throw new TypeError();
    const fs = Reflect.get(adapter, "fs") as unknown;
    if (!fs || typeof fs !== "object") throw new TypeError();
    const method = Reflect.get(fs, methodName) as unknown;
    if (typeof method !== "function") throw new TypeError();
    return (path: string): TResult => Reflect.apply(method, fs, [path]) as TResult;
  } catch {
    throw new TypeError(`adapter.fs.${methodName} must be a function`);
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
  if (
    typeof operationPrefix !== "string" || operationPrefix.trim().length === 0 ||
    operationPrefix.length > 256 || hasUnsafeControlCharacters(operationPrefix)
  ) {
    throw new TypeError("operationPrefix must be a non-empty string of at most 256 characters");
  }
  const stableOperationPrefix = operationPrefix;

  function buildContext(details: Omit<ErrorContext, "operation">): ErrorContext {
    try {
      if (!details || typeof details !== "object" || Array.isArray(details)) {
        throw new TypeError();
      }
      return snapshotErrorContext({
        operation: stableOperationPrefix,
        path: details.path,
        slug: details.slug,
        details: details.details,
      });
    } catch {
      throw new TypeError("Invalid scoped error details");
    }
  }

  return {
    async run<T>(
      operation: () => Promise<T>,
      details: Omit<ErrorContext, "operation">,
      fallback: T,
      logLevel: LogLevel = "debug",
    ): Promise<T> {
      return await withErrorContext(operation, buildContext(details), { fallback, logLevel });
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
