import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_MAX_DELAY_MS,
} from "#veryfront/utils/constants/retry.ts";
import { VeryfrontError } from "./types.ts";
import { wrapUnknownError, wrapWithContext } from "./middleware/wrap-unknown.ts";
import { ensureError } from "./veryfront-error.ts";
import { logError } from "./logging.ts";

function safeLog(logFn: () => void): void {
  try {
    logFn();
  } catch (error) {
    try {
      serverLogger.warn("[errors] Logging failed:", error);
    } catch {
      // Silently ignore if even warning fails
    }
  }
}

/**
 * Log an error with structured formatting
 *
 * @deprecated Use error boundary middleware (httpErrorBoundary, cliErrorBoundary) instead.
 * Error boundaries handle both catching, logging, and formatting automatically.
 *
 * For VeryfrontError instances, logs slug, category, and other structured fields.
 * For plain Errors, wraps as unknown-error and logs with structured format.
 *
 * This function is kept for backward compatibility but will be removed in a future version.
 * Now delegates to logError() for unified observability.
 */
export function handleError(error: Error): void {
  const vfError = error instanceof VeryfrontError ? error : wrapUnknownError(error);

  safeLog(() => logError(vfError));
}

/**
 * Wrap an error with additional context and message
 *
 * Uses the unified wrapWithContext from middleware for consistent wrapping.
 * Preserves slug for VeryfrontError, wraps plain Errors as unknown-error.
 *
 * @param error - Any error value
 * @param message - Additional message to prepend
 * @param context - Additional context to add
 * @returns VeryfrontError with added context
 */
export function wrapError(
  error: unknown,
  message: string,
  context?: unknown,
): VeryfrontError {
  return wrapWithContext(error, message, context as Record<string, unknown> | undefined);
}

/**
 * Log an error and re-throw it
 *
 * @deprecated This function is deprecated in favor of error boundary middleware.
 * Use `httpErrorBoundary()` or `cliErrorBoundary()` at system boundaries instead.
 * Error boundaries handle both logging and formatting automatically.
 *
 * @param error - Error to log and throw
 * @param message - Optional message to prepend
 * @param logger - Logger instance to use
 */
export function logAndThrow(
  error: unknown,
  message?: string,
  logger: typeof serverLogger = serverLogger,
): never {
  const errorObj = ensureError(error);
  const logMessage = message ? `${message}: ${errorObj.message}` : errorObj.message;

  safeLog(() => logger.error(logMessage, error));

  throw errorObj;
}

export async function handleErrorWithFallback<T>(
  fn: () => T | Promise<T>,
  fallback: T,
  logger: typeof serverLogger = serverLogger,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    safeLog(() => logger.warn("Operation failed, using fallback", error));
    return fallback;
  }
}

export function handleErrorWithFallbackSync<T>(
  fn: () => T,
  fallback: T,
  logger: typeof serverLogger = serverLogger,
): T {
  try {
    return fn();
  } catch (error) {
    safeLog(() => logger.warn("Operation failed, using fallback", error));
    return fallback;
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    logger?: typeof serverLogger;
  } = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_RETRY_MAX_ATTEMPTS,
    initialDelay = DEFAULT_RETRY_INITIAL_DELAY_MS,
    maxDelay = DEFAULT_RETRY_MAX_DELAY_MS,
    logger: log = serverLogger,
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      safeLog(() => log.warn(`Attempt ${attempt + 1} failed, retrying...`, error));

      if (attempt >= maxRetries - 1) {
        continue;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  throw lastError;
}
