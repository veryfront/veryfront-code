import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sleep } from "#veryfront/utils/sleep.ts";
import {
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_MAX_DELAY_MS,
} from "#veryfront/utils/constants/retry.ts";
const logger = serverLogger.component("errors");

function safeLog(logFn: () => void): void {
  try {
    logFn();
  } catch (error) {
    try {
      logger.warn("Logging failed:", error);
    } catch (_) {
      // expected: last-resort fallback; nothing left to do if logging itself fails
    }
  }
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

/**
 * Options for {@link retryWithBackoff}. Every `attempt` value passed to `fn`
 * and the hooks below is 0-based (first try = 0), including
 * `wrapFinalError`'s `lastAttempt`.
 */
export interface RetryWithBackoffOptions {
  /** Total number of attempts (first try included). */
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  logger?: typeof serverLogger;
  /** Per-attempt timeout; aborts the attempt's signal with an AbortError. */
  timeoutMs?: number;
  /** Return false to rethrow immediately without further attempts (default: always retry). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Override the exponential backoff delay for the wait after `attempt`. */
  computeDelay?: (attempt: number, error: unknown) => number;
  /** Called before each backoff wait; replaces the default warn log. */
  onRetry?: (info: { error: Error; attempt: number; delay: number; isTimeout: boolean }) => void;
  /** Wrap the terminal error once all attempts are exhausted (default: rethrow as-is). */
  wrapFinalError?: (lastError: Error, lastAttempt: number) => Error;
}

export async function retryWithBackoff<T>(
  fn: (signal: AbortSignal | undefined, attempt: number) => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_RETRY_MAX_ATTEMPTS,
    initialDelay = DEFAULT_RETRY_INITIAL_DELAY_MS,
    maxDelay = DEFAULT_RETRY_MAX_DELAY_MS,
    logger: retryLogger = serverLogger,
    timeoutMs,
    shouldRetry,
    computeDelay,
    onRetry,
    wrapFinalError,
  } = options;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      `retryWithBackoff requires an integer maxAttempts >= 1, got ${maxAttempts}`,
    );
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = timeoutMs === undefined ? undefined : new AbortController();
    const timeoutId = controller === undefined
      ? undefined
      : setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fn(controller?.signal, attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw error;
      }

      if (attempt >= maxAttempts - 1) {
        break;
      }

      const delay = computeDelay
        ? computeDelay(attempt, error)
        : Math.min(initialDelay * 2 ** attempt, maxDelay);
      const isTimeout = lastError.name === "AbortError";

      if (onRetry) {
        onRetry({ error: lastError, attempt, delay, isTimeout });
      } else {
        safeLog(() => retryLogger.warn(`Attempt ${attempt + 1} failed, retrying...`, lastError));
      }

      await sleep(delay);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const finalError = lastError ?? new Error("Retry failed without capturing an error");
  throw wrapFinalError ? wrapFinalError(finalError, Math.max(0, maxAttempts - 1)) : finalError;
}
