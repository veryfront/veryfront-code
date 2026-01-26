import * as dntShim from "../../_dnt.shims.js";
import { serverLogger } from "../utils/logger/logger.js";
import { ErrorCode, VeryfrontError } from "./types.js";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 5000;
function safeLog(logFn) {
    try {
        logFn();
    }
    catch (error) {
        try {
            serverLogger.warn("[errors] Logging failed:", error);
        }
        catch {
            // Silently ignore if even warning fails
        }
    }
}
export function handleError(error) {
    safeLog(() => serverLogger.error(`Error: ${error.message}`));
    if (error instanceof VeryfrontError && error.context) {
        safeLog(() => serverLogger.error("Context:", error.context));
    }
    if (error.stack) {
        safeLog(() => serverLogger.error(error.stack));
    }
}
export function wrapError(error, message, context) {
    const originalError = error instanceof Error ? error : new Error(String(error));
    const errorMessage = `${message}: ${originalError.message}`;
    const wrappedContext = {
        originalError: {
            name: originalError.name,
            message: originalError.message,
            stack: originalError.stack,
        },
        ...context,
    };
    const errorCode = error instanceof VeryfrontError ? error.code : ErrorCode.RENDER_ERROR;
    return new VeryfrontError(errorMessage, errorCode, wrappedContext);
}
export function logAndThrow(error, message, logger = serverLogger) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const logMessage = message ? `${message}: ${errorObj.message}` : errorObj.message;
    safeLog(() => logger.error(logMessage, error));
    throw error instanceof Error ? error : errorObj;
}
export async function handleErrorWithFallback(fn, fallback, logger = serverLogger) {
    try {
        return await fn();
    }
    catch (error) {
        safeLog(() => logger.warn("Operation failed, using fallback", error));
        return fallback;
    }
}
export function handleErrorWithFallbackSync(fn, fallback, logger = serverLogger) {
    try {
        return fn();
    }
    catch (error) {
        safeLog(() => logger.warn("Operation failed, using fallback", error));
        return fallback;
    }
}
export async function retryWithBackoff(fn, options = {}) {
    const { maxRetries = DEFAULT_MAX_RETRIES, initialDelay = DEFAULT_INITIAL_DELAY_MS, maxDelay = DEFAULT_MAX_DELAY_MS, logger: log = serverLogger, } = options;
    let lastError;
    let delay = initialDelay;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            safeLog(() => log.warn(`Attempt ${attempt + 1} failed, retrying...`, error));
            if (attempt >= maxRetries - 1)
                continue;
            await new Promise((resolve) => dntShim.setTimeout(resolve, delay));
            delay = Math.min(delay * 2, maxDelay);
        }
    }
    throw lastError;
}
