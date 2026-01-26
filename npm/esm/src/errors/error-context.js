/** Structured error handling with logging for silent failure operations */
import { serverLogger } from "../utils/logger/logger.js";
import { getErrorMessage } from "./veryfront-error.js";
function getErrorStack(error) {
    return error instanceof Error ? error.stack : undefined;
}
function logError(error, context, logLevel = "debug", includeStack = false) {
    const message = getErrorMessage(error);
    const logData = {
        ...context.details,
        path: context.path,
        slug: context.slug,
        errorMessage: message,
    };
    if (includeStack) {
        const stack = getErrorStack(error);
        if (stack)
            logData.stack = stack;
    }
    const logMessage = `[${context.operation}] Silent failure: ${message}`;
    switch (logLevel) {
        case "error":
            serverLogger.error(logMessage, logData);
            return;
        case "warn":
            serverLogger.warn(logMessage, logData);
            return;
        default:
            serverLogger.debug(logMessage, logData);
    }
}
/** Execute async operation with error logging and fallback */
export async function withErrorContext(operation, context, options) {
    try {
        return await operation();
    }
    catch (error) {
        logError(error, context, options.logLevel, options.includeStack);
        return options.fallback;
    }
}
/** Execute sync operation with error logging and fallback */
export function withErrorContextSync(operation, context, options) {
    try {
        return operation();
    }
    catch (error) {
        logError(error, context, options.logLevel, options.includeStack);
        return options.fallback;
    }
}
/** Safe file stat with logging */
export function safeFileStat(adapter, path, operation) {
    return withErrorContext(() => adapter.fs.stat(path), { operation, path }, { fallback: null, logLevel: "debug" });
}
/** Safe file read with logging */
export function safeFileRead(adapter, path, operation) {
    return withErrorContext(() => adapter.fs.readFile(path), { operation, path }, { fallback: null, logLevel: "debug" });
}
/** Safe directory read with logging */
export async function safeReadDir(adapter, path, operation) {
    try {
        const results = [];
        for await (const entry of adapter.fs.readDir(path))
            results.push(entry);
        return results;
    }
    catch (error) {
        logError(error, { operation, path }, "debug");
        return [];
    }
}
/** Create a scoped error context helper for multiple related operations */
export function createErrorScope(operationPrefix) {
    function buildContext(details) {
        return { operation: operationPrefix, ...details };
    }
    return {
        run(operation, details, fallback, logLevel = "debug") {
            return withErrorContext(operation, buildContext(details), { fallback, logLevel });
        },
        runSync(operation, details, fallback, logLevel = "debug") {
            return withErrorContextSync(operation, buildContext(details), { fallback, logLevel });
        },
    };
}
