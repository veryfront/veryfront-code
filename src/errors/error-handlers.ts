import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_MAX_DELAY_MS,
} from "#veryfront/utils/constants/retry.ts";
const log = serverLogger.component("errors");

function safeLog(logFn: () => void): void {
  try {
    logFn();
  } catch (error) {
    try {
      log.warn("Logging failed:", error);
    } catch {
      // Silently ignore if even warning fails
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
