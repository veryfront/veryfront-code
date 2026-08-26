import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sleep } from "#veryfront/utils/sleep.ts";
import {
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_MAX_DELAY_MS,
} from "#veryfront/utils/constants/retry.ts";
import { normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";
import { detachThrowableForBoundary } from "./safe-diagnostics.ts";
import { isNativeErrorWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const numberIsInteger = Number.isInteger;
const defineProperty = Object.defineProperty;
const NativeError = Error;

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

function detachThrowableForFallbackLog(error: unknown): Error {
  const diagnostic = detachThrowableForBoundary(error);
  diagnostic.stack = undefined;
  return diagnostic;
}

function createRetryTimeoutError(): Error {
  const error = new NativeError("The operation was aborted");
  defineProperty(error, "name", {
    configurable: true,
    enumerable: false,
    value: "AbortError",
    writable: true,
  });
  return error;
}

export async function handleErrorWithFallback<T>(
  fn: () => T | Promise<T>,
  fallback: T,
  logger: typeof serverLogger = serverLogger,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    safeLog(() =>
      logger.warn("Operation failed, using fallback", detachThrowableForFallbackLog(error))
    );
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
    safeLog(() =>
      logger.warn("Operation failed, using fallback", detachThrowableForFallbackLog(error))
    );
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
  /** Cancels the active attempt and any pending backoff delay. */
  abortSignal?: AbortSignal;
  initialDelay?: number;
  maxDelay?: number;
  logger?: typeof serverLogger;
  /**
   * Per-attempt timeout: aborts the attempt's AbortSignal with an AbortError.
   * Cooperative - the attempt only stops if `fn` observes the signal it is given.
   */
  timeoutMs?: number;
  /** Return false to rethrow immediately without further attempts (default: always retry). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Override the exponential backoff delay for the wait after `attempt`. */
  computeDelay?: (attempt: number, error: unknown) => number;
  /**
   * Called before each backoff wait; replaces the default warn log.
   * `isTimeout` reports whether this helper's per-attempt timer aborted the
   * signal, independent of the error type ultimately thrown by `fn`.
   */
  onRetry?: (info: { error: Error; attempt: number; delay: number; isTimeout: boolean }) => void;
  /**
   * Wrap the terminal error once all attempts are exhausted. Default: rethrow
   * the normalized Error (non-Error throws become `new Error(String(value))`).
   */
  wrapFinalError?: (lastError: Error, lastAttempt: number) => Error;
}

interface RetryAbortSignalScope {
  signal: AbortSignal | undefined;
  dispose(): void;
}

function composeRetryAbortSignals(
  signals: readonly (AbortSignal | undefined)[],
): RetryAbortSignalScope {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (activeSignals.length < 2) {
    return {
      signal: activeSignals[0],
      dispose() {},
    };
  }
  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any(activeSignals),
      dispose() {},
    };
  }

  const controller = new AbortController();
  const removers: Array<() => void> = [];
  const dispose = () => {
    for (const remove of removers) remove();
    removers.length = 0;
  };
  controller.signal.addEventListener("abort", dispose, { once: true });
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const forwardAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", forwardAbort, { once: true });
    removers.push(() => signal.removeEventListener("abort", forwardAbort));
    if (signal.aborted) {
      forwardAbort();
      break;
    }
  }
  return { signal: controller.signal, dispose };
}

export async function retryWithBackoff<T>(
  fn: (signal: AbortSignal | undefined, attempt: number) => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_RETRY_MAX_ATTEMPTS,
    abortSignal,
    initialDelay = DEFAULT_RETRY_INITIAL_DELAY_MS,
    maxDelay = DEFAULT_RETRY_MAX_DELAY_MS,
    logger: retryLogger = serverLogger,
    timeoutMs,
    shouldRetry,
    computeDelay,
    onRetry,
    wrapFinalError,
  } = options;

  if (!numberIsInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      `retryWithBackoff requires an integer maxAttempts >= 1, got ${maxAttempts}`,
    );
  }
  const normalizedInitialDelay = normalizeTimerDurationMs(initialDelay, "initialDelay");
  const normalizedMaxDelay = normalizeTimerDurationMs(maxDelay, "maxDelay");
  const normalizedTimeoutMs = timeoutMs === undefined
    ? undefined
    : normalizeTimerDurationMs(timeoutMs, "timeoutMs");

  let lastError: Error | undefined;
  let lastThrown: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    abortSignal?.throwIfAborted();
    const controller = normalizedTimeoutMs === undefined ? undefined : new AbortController();
    const attemptSignal = composeRetryAbortSignals([
      controller?.signal,
      abortSignal,
    ]);
    const timeoutId = controller === undefined ? undefined : setTimeout(
      () => controller.abort(createRetryTimeoutError()),
      normalizedTimeoutMs,
    );

    try {
      try {
        return await fn(attemptSignal.signal, attempt);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        attemptSignal.dispose();
      }
    } catch (error) {
      abortSignal?.throwIfAborted();
      lastThrown = error;

      if (shouldRetry && !shouldRetry(error, attempt)) {
        throw error;
      }
      lastError = detachThrowableForBoundary(error);

      if (attempt >= maxAttempts - 1) {
        break;
      }
      abortSignal?.throwIfAborted();

      const requestedDelay = computeDelay
        ? computeDelay(attempt, error)
        : Math.min(normalizedInitialDelay * 2 ** attempt, normalizedMaxDelay);
      const delay = normalizeTimerDurationMs(
        requestedDelay,
        computeDelay ? "computeDelay result" : "retry delay",
      );
      const isTimeout = controller?.signal.aborted === true;

      if (onRetry) {
        onRetry({ error: lastError, attempt, delay, isTimeout });
      } else {
        safeLog(() => retryLogger.warn(`Attempt ${attempt + 1} failed, retrying...`, lastError));
      }

      await sleep(delay, abortSignal);
    }
  }

  const finalError = lastError ?? new NativeError("Retry failed without capturing an error");
  if (wrapFinalError) {
    throw wrapFinalError(finalError, Math.max(0, maxAttempts - 1));
  }
  throw isNativeErrorWithoutHooks(lastThrown) ? lastThrown : finalError;
}
