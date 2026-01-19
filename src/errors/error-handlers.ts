import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { ErrorCode, VeryfrontError } from "./types.ts";

/** Default max retries for retry operations */
const DEFAULT_MAX_RETRIES = 3;

/** Default initial delay for exponential backoff (100ms) */
const DEFAULT_INITIAL_DELAY_MS = 100;

/** Default max delay cap for exponential backoff (5 seconds) */
const DEFAULT_MAX_DELAY_MS = 5000;

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

export function handleError(error: Error): void {
  safeLog(() => serverLogger.error(`Error: ${error.message}`));

  if (error instanceof VeryfrontError && error.context) {
    safeLog(() => serverLogger.error("Context:", error.context));
  }

  if (error.stack) {
    safeLog(() => serverLogger.error(error.stack as string));
  }
}

export function wrapError(
  error: unknown,
  message: string,
  context?: unknown,
): VeryfrontError {
  const originalError = error instanceof Error ? error : new Error(String(error));
  const errorMessage = `${message}: ${originalError.message}`;

  const wrappedContext = {
    originalError: {
      name: originalError.name,
      message: originalError.message,
      stack: originalError.stack,
    },
    ...(context as Record<string, unknown> | undefined),
  };

  const errorCode = error instanceof VeryfrontError ? error.code : ErrorCode.RENDER_ERROR;

  return new VeryfrontError(errorMessage, errorCode, wrappedContext);
}

export function logAndThrow(
  error: unknown,
  message?: string,
  logger: typeof serverLogger = serverLogger,
): never {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  const logMessage = message ? `${message}: ${errorObj.message}` : errorObj.message;

  safeLog(() => logger.error(logMessage, error));

  if (error instanceof Error) {
    throw error;
  }
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
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelay = DEFAULT_INITIAL_DELAY_MS,
    maxDelay = DEFAULT_MAX_DELAY_MS,
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

      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, maxDelay);
      }
    }
  }

  throw lastError;
}
