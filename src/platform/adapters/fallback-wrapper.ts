import { logger } from "@veryfront/utils";

export interface FallbackOptions {
  operationName: string;
  logError?: boolean;
  rethrowOnFallbackFailure?: boolean;
}

export class FallbackExecutionError extends Error {
  constructor(
    message: string,
    public readonly primaryError: unknown,
    public readonly fallbackError?: unknown,
  ) {
    super(message);
    this.name = "FallbackExecutionError";
  }
}

export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  options: FallbackOptions,
): Promise<T> {
  const { operationName, logError = true, rethrowOnFallbackFailure = true } = options;

  try {
    return await primary();
  } catch (primaryError) {
    if (logError) {
      logger.debug(
        `[fallback-wrapper] Primary operation failed for ${operationName}, attempting fallback`,
        primaryError,
      );
    }

    try {
      const result = await fallback();
      if (logError) {
        logger.debug(`[fallback-wrapper] Fallback succeeded for ${operationName}`);
      }
      return result;
    } catch (fallbackError) {
      if (logError) {
        logger.error(
          `[fallback-wrapper] Both primary and fallback failed for ${operationName}`,
          { primaryError, fallbackError },
        );
      }

      if (rethrowOnFallbackFailure) {
        throw new FallbackExecutionError(
          `Both primary and fallback operations failed for ${operationName}`,
          primaryError,
          fallbackError,
        );
      }

      throw fallbackError;
    }
  }
}

export function withFallbackSync<T>(
  primary: () => T,
  fallback: () => T,
  options: FallbackOptions,
): T {
  const { operationName, logError = true, rethrowOnFallbackFailure = true } = options;

  try {
    return primary();
  } catch (primaryError) {
    if (logError) {
      logger.debug(
        `[fallback-wrapper] Primary operation failed for ${operationName}, attempting fallback`,
        primaryError,
      );
    }

    try {
      const result = fallback();
      if (logError) {
        logger.debug(`[fallback-wrapper] Fallback succeeded for ${operationName}`);
      }
      return result;
    } catch (fallbackError) {
      if (logError) {
        logger.error(
          `[fallback-wrapper] Both primary and fallback failed for ${operationName}`,
          { primaryError, fallbackError },
        );
      }

      if (rethrowOnFallbackFailure) {
        throw new FallbackExecutionError(
          `Both primary and fallback operations failed for ${operationName}`,
          primaryError,
          fallbackError,
        );
      }

      throw fallbackError;
    }
  }
}

export interface AsyncAdapterFallback<T> {
  execute: () => Promise<T>;
}

export interface SyncAdapterFallback<T> {
  executeSync: () => T;
}

export function createAdapterFallback<T>(
  adapterOperation: () => Promise<T>,
  directOperation: () => Promise<T>,
  operationName: string,
  options?: Partial<Omit<FallbackOptions, "operationName">>,
): AsyncAdapterFallback<T> {
  return {
    execute: () =>
      withFallback(adapterOperation, directOperation, {
        operationName,
        ...options,
      }),
  };
}

export function createAdapterFallbackSync<T>(
  adapterOperation: () => T,
  directOperation: () => T,
  operationName: string,
  options?: Partial<Omit<FallbackOptions, "operationName">>,
): SyncAdapterFallback<T> {
  return {
    executeSync: () =>
      withFallbackSync(adapterOperation, directOperation, {
        operationName,
        ...options,
      }),
  };
}
