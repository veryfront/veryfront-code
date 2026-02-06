import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_MAX_DELAY_MS,
} from "#veryfront/utils/constants/retry.ts";
import { VeryfrontError } from "./types.ts";
import { RENDER_ERROR } from "./error-registry.ts";
import { ensureError } from "./veryfront-error.ts";

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
    const stack = error.stack;
    safeLog(() => serverLogger.error(stack));
  }
}

export function wrapError(
  error: unknown,
  message: string,
  context?: unknown,
): VeryfrontError {
  const originalError = ensureError(error);
  const errorMessage = `${message}: ${originalError.message}`;

  const wrappedContext = {
    originalError: {
      name: originalError.name,
      message: originalError.message,
      stack: originalError.stack,
    },
    ...(context as Record<string, unknown> | undefined),
  };

  // Preserve slug/code from original error, or use render-error as default
  if (error instanceof VeryfrontError) {
    return new VeryfrontError(errorMessage, {
      slug: error.slug,
      category: error.category,
      status: error.status,
      title: error.title,
      suggestion: error.suggestion,
      context: wrappedContext,
    });
  }

  return new VeryfrontError(errorMessage, {
    slug: RENDER_ERROR.slug,
    category: RENDER_ERROR.category,
    status: RENDER_ERROR.status,
    title: RENDER_ERROR.title,
    suggestion: RENDER_ERROR.suggestion,
    context: wrappedContext,
  });
}

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
