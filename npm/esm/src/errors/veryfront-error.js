export function createError(error) {
    return error;
}
/** Type guard factory for VeryfrontError types */
function isErrorType(type) {
    return (error) => error.type === type;
}
export const isBuildError = isErrorType("build");
export const isAPIError = isErrorType("api");
export const isRenderError = isErrorType("render");
export const isConfigError = isErrorType("config");
export const isAgentError = isErrorType("agent");
export const isFileError = isErrorType("file");
export const isNetworkError = isErrorType("network");
export function toError(veryfrontError) {
    const error = new Error(veryfrontError.message);
    error.name = `VeryfrontError[${veryfrontError.type}]`;
    Object.defineProperty(error, "context", {
        value: veryfrontError,
        enumerable: false,
        configurable: true,
    });
    return error;
}
export function fromError(error) {
    if (!error || typeof error !== "object" || !("context" in error))
        return null;
    const context = error.context;
    if (!context || typeof context !== "object")
        return null;
    if (!("type" in context) || !("message" in context))
        return null;
    return context;
}
export function logError(error, logger) {
    const log = logger ?? console;
    const context = "context" in error ? error.context : {};
    log.error(`[${error.type}] ${error.message}`, context ?? {});
}
/**
 * Extract error message from any error type
 */
export function getErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Ensure error is an Error instance
 */
export function ensureError(error) {
    if (error instanceof Error)
        return error;
    return new Error(String(error));
}
