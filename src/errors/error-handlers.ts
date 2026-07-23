import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_MAX_DELAY_MS,
} from "#veryfront/utils/constants/retry.ts";
const logger = serverLogger.component("errors");

/** Minimal logging contract required by the error helpers. */
export interface ErrorHandlerLogger {
  /** Write a warning without requiring a concrete logger implementation. */
  warn(message: string, ...args: unknown[]): void;
}

type WarningCallback = (message: string) => void;

function snapshotWarningCallback(value: ErrorHandlerLogger): WarningCallback {
  try {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      throw new TypeError();
    }
    const warn = value.warn;
    if (typeof warn !== "function") throw new TypeError();
    return (message: string): void => warn.call(value, message);
  } catch {
    throw new TypeError("logger must provide a warn method");
  }
}

function assertOperation(value: unknown): asserts value is () => unknown {
  if (typeof value !== "function") throw new TypeError("fn must be a function");
}

function safeLog(logFn: () => void): void {
  try {
    logFn();
  } catch {
    try {
      logger.warn("Error helper logging failed");
    } catch (_) {
      // expected: last-resort fallback; nothing left to do if logging itself fails
    }
  }
}

/** Execute an operation and return an explicit fallback if it fails. */
export async function handleErrorWithFallback<T>(
  fn: () => T | Promise<T>,
  fallback: T,
  logger: ErrorHandlerLogger = serverLogger,
): Promise<T> {
  assertOperation(fn);
  const warn = snapshotWarningCallback(logger);
  try {
    return await fn();
  } catch {
    safeLog(() => warn("Operation failed, using fallback"));
    return fallback;
  }
}

/** Execute a synchronous operation and return an explicit fallback if it fails. */
export function handleErrorWithFallbackSync<T>(
  fn: () => T,
  fallback: T,
  logger: ErrorHandlerLogger = serverLogger,
): T {
  assertOperation(fn);
  const warn = snapshotWarningCallback(logger);
  try {
    return fn();
  } catch {
    safeLog(() => warn("Operation failed, using fallback"));
    return fallback;
  }
}

/** Bounded retry and cancellation options for {@link retryWithBackoff}. */
export interface RetryWithBackoffOptions {
  /** Total number of attempts, including the first call. */
  maxRetries?: number;
  /** Delay before the first retry, in milliseconds. */
  initialDelay?: number;
  /** Maximum delay between retries, in milliseconds. */
  maxDelay?: number;
  /** Logger used for stable retry warnings. */
  logger?: ErrorHandlerLogger;
  /** Signal that cancels attempts and pending backoff. */
  signal?: AbortSignal;
}

interface RetrySnapshot {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  warn: WarningCallback;
  signal?: AbortSignal;
}

const MAX_RETRY_ATTEMPTS = 100;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

class RetryOptionValidationError extends TypeError {}

function assertBoundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RetryOptionValidationError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value as number;
}

function snapshotRetryOptions(options: RetryWithBackoffOptions): RetrySnapshot {
  try {
    if (!options || typeof options !== "object") {
      throw new RetryOptionValidationError("options must be an object");
    }
    const maxRetries = assertBoundedInteger(
      options.maxRetries ?? DEFAULT_RETRY_MAX_ATTEMPTS,
      "maxRetries",
      1,
      MAX_RETRY_ATTEMPTS,
    );
    const initialDelay = assertBoundedInteger(
      options.initialDelay ?? DEFAULT_RETRY_INITIAL_DELAY_MS,
      "initialDelay",
      0,
      MAX_TIMER_DELAY_MS,
    );
    const maxDelay = assertBoundedInteger(
      options.maxDelay ?? DEFAULT_RETRY_MAX_DELAY_MS,
      "maxDelay",
      0,
      MAX_TIMER_DELAY_MS,
    );
    if (initialDelay > maxDelay) {
      throw new RetryOptionValidationError("initialDelay must not exceed maxDelay");
    }
    const retryLogger = options.logger ?? serverLogger;
    const warn = snapshotWarningCallback(retryLogger);
    const signal = options.signal;
    if (
      signal !== undefined &&
      (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean" ||
        typeof signal.addEventListener !== "function" ||
        typeof signal.removeEventListener !== "function")
    ) {
      throw new RetryOptionValidationError("signal must be an AbortSignal");
    }

    return {
      maxRetries,
      initialDelay,
      maxDelay,
      warn,
      signal,
    };
  } catch (error) {
    if (error instanceof RetryOptionValidationError) {
      throw new TypeError(error.message);
    }
    throw new TypeError("Invalid retry options");
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortableDelay(delay: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal ? abortReason(signal) : new DOMException("The operation was aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function executeWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetrySnapshot,
): Promise<T> {
  const {
    maxRetries,
    initialDelay,
    maxDelay,
    warn,
    signal,
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);

      if (attempt >= maxRetries - 1) {
        continue;
      }

      safeLog(() => warn(`Attempt ${attempt + 1} failed, retrying`));
      await abortableDelay(delay, signal);
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  throw lastError;
}

/** Retry an asynchronous operation with bounded exponential backoff. */
export function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  if (typeof fn !== "function") throw new TypeError("fn must be a function");
  return executeWithBackoff(fn, snapshotRetryOptions(options));
}
