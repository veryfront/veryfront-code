/**
 * Token Storage Adapter Types
 *
 * Defines the interface for token storage backends.
 * Tokens are encrypted client-side before being sent to the backend.
 */
import { createError, toError } from "../../../../errors/index.js";
function requireVeryfrontConfig(config) {
    if (!config.veryfront) {
        throw toError(createError({
            type: "config",
            message: "Veryfront token adapter requires veryfront configuration",
        }));
    }
    return config.veryfront;
}
/**
 * Create verified config from adapter config
 */
export function createTokenConfig(config) {
    const veryfront = requireVeryfrontConfig(config);
    if (!veryfront.apiToken) {
        throw toError(createError({
            type: "config",
            message: "Veryfront token adapter requires apiToken",
        }));
    }
    if (!veryfront.projectSlug) {
        throw toError(createError({
            type: "config",
            message: "Veryfront token adapter requires projectSlug",
        }));
    }
    return {
        apiBaseUrl: veryfront.baseUrl || "https://api.veryfront.com",
        apiToken: veryfront.apiToken,
        projectSlug: veryfront.projectSlug,
        retry: {
            maxRetries: veryfront.retry?.maxRetries ?? 3,
            initialDelay: veryfront.retry?.initialDelay ?? 1000,
            maxDelay: veryfront.retry?.maxDelay ?? 10000,
        },
    };
}
/**
 * Error thrown by token storage operations
 */
export class TokenStorageError extends Error {
    statusCode;
    details;
    constructor(message, statusCode, details) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.name = "TokenStorageError";
    }
}
