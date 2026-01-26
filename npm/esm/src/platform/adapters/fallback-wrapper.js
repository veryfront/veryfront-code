import { logger } from "../../utils/index.js";
export class FallbackExecutionError extends Error {
    primaryError;
    fallbackError;
    constructor(message, primaryError, fallbackError) {
        super(message);
        this.primaryError = primaryError;
        this.fallbackError = fallbackError;
        this.name = "FallbackExecutionError";
    }
}
function logPrimaryFailure(operationName, error) {
    logger.debug(`[fallback-wrapper] Primary operation failed for ${operationName}, attempting fallback`, error);
}
function logFallbackSuccess(operationName) {
    logger.debug(`[fallback-wrapper] Fallback succeeded for ${operationName}`);
}
function handleFallbackFailure(operationName, primaryError, fallbackError, logError, rethrowOnFallbackFailure) {
    if (logError) {
        logger.error(`[fallback-wrapper] Both primary and fallback failed for ${operationName}`, { primaryError, fallbackError });
    }
    if (rethrowOnFallbackFailure) {
        throw new FallbackExecutionError(`Both primary and fallback operations failed for ${operationName}`, primaryError, fallbackError);
    }
    throw fallbackError;
}
function getFallbackConfig(options) {
    return {
        operationName: options.operationName,
        logError: options.logError ?? true,
        rethrowOnFallbackFailure: options.rethrowOnFallbackFailure ?? true,
    };
}
export async function withFallback(primary, fallback, options) {
    const { operationName, logError, rethrowOnFallbackFailure } = getFallbackConfig(options);
    try {
        return await primary();
    }
    catch (primaryError) {
        if (logError)
            logPrimaryFailure(operationName, primaryError);
        try {
            const result = await fallback();
            if (logError)
                logFallbackSuccess(operationName);
            return result;
        }
        catch (fallbackError) {
            return handleFallbackFailure(operationName, primaryError, fallbackError, logError, rethrowOnFallbackFailure);
        }
    }
}
export function withFallbackSync(primary, fallback, options) {
    const { operationName, logError, rethrowOnFallbackFailure } = getFallbackConfig(options);
    try {
        return primary();
    }
    catch (primaryError) {
        if (logError)
            logPrimaryFailure(operationName, primaryError);
        try {
            const result = fallback();
            if (logError)
                logFallbackSuccess(operationName);
            return result;
        }
        catch (fallbackError) {
            return handleFallbackFailure(operationName, primaryError, fallbackError, logError, rethrowOnFallbackFailure);
        }
    }
}
export function createAdapterFallback(adapterOperation, directOperation, operationName, options) {
    return {
        execute: () => withFallback(adapterOperation, directOperation, {
            operationName,
            ...options,
        }),
    };
}
export function createAdapterFallbackSync(adapterOperation, directOperation, operationName, options) {
    return {
        executeSync: () => withFallbackSync(adapterOperation, directOperation, {
            operationName,
            ...options,
        }),
    };
}
