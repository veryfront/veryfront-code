import { logger } from "#veryfront/utils";
import { FALLBACK_EXHAUSTED } from "#veryfront/errors/error-registry.ts";

export { FALLBACK_EXHAUSTED } from "#veryfront/errors/error-registry.ts";

export interface FallbackOptions {
  operationName: string;
  logError?: boolean;
  rethrowOnFallbackFailure?: boolean;
}

function logPrimaryFailure(operationName: string, error: unknown): void {
  logger.debug(
    `[fallback-wrapper] Primary operation failed for ${operationName}, attempting fallback`,
    error,
  );
}

function logFallbackSuccess(operationName: string): void {
  logger.debug(`[fallback-wrapper] Fallback succeeded for ${operationName}`);
}

function handleFallbackFailure(
  operationName: string,
  primaryError: unknown,
  fallbackError: unknown,
  logError: boolean,
  rethrowOnFallbackFailure: boolean,
): never {
  if (logError) {
    logger.error(
      `[fallback-wrapper] Both primary and fallback failed for ${operationName}`,
      { primaryError, fallbackError },
    );
  }

  if (rethrowOnFallbackFailure) {
    throw FALLBACK_EXHAUSTED.create({
      detail: `Both primary and fallback operations failed for ${operationName}`,
      cause: primaryError,
      context: { operationName, primaryError, fallbackError },
    });
  }

  throw fallbackError;
}

function getFallbackConfig(options: FallbackOptions): Required<FallbackOptions> {
  return {
    operationName: options.operationName,
    logError: options.logError ?? true,
    rethrowOnFallbackFailure: options.rethrowOnFallbackFailure ?? true,
  };
}

export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  options: FallbackOptions,
): Promise<T> {
  const { operationName, logError, rethrowOnFallbackFailure } = getFallbackConfig(options);

  try {
    return await primary();
  } catch (primaryError) {
    if (logError) logPrimaryFailure(operationName, primaryError);

    try {
      const result = await fallback();
      if (logError) logFallbackSuccess(operationName);
      return result;
    } catch (fallbackError) {
      handleFallbackFailure(
        operationName,
        primaryError,
        fallbackError,
        logError,
        rethrowOnFallbackFailure,
      );
    }
  }
}

export function withFallbackSync<T>(
  primary: () => T,
  fallback: () => T,
  options: FallbackOptions,
): T {
  const { operationName, logError, rethrowOnFallbackFailure } = getFallbackConfig(options);

  try {
    return primary();
  } catch (primaryError) {
    if (logError) logPrimaryFailure(operationName, primaryError);

    try {
      const result = fallback();
      if (logError) logFallbackSuccess(operationName);
      return result;
    } catch (fallbackError) {
      handleFallbackFailure(
        operationName,
        primaryError,
        fallbackError,
        logError,
        rethrowOnFallbackFailure,
      );
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
    execute(): Promise<T> {
      return withFallback(adapterOperation, directOperation, { operationName, ...options });
    },
  };
}

export function createAdapterFallbackSync<T>(
  adapterOperation: () => T,
  directOperation: () => T,
  operationName: string,
  options?: Partial<Omit<FallbackOptions, "operationName">>,
): SyncAdapterFallback<T> {
  return {
    executeSync(): T {
      return withFallbackSync(adapterOperation, directOperation, { operationName, ...options });
    },
  };
}
