import { handleCORSPreflight, isPreflightRequest } from "./preflight.js";
import { applyCORSHeaders } from "./headers.js";
import { validateCORSConfig } from "./validators.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
export function cors(config) {
    const validation = validateCORSConfig(config);
    if (!validation.valid) {
        throw toError(createError({
            type: "config",
            message: `[CORS] Invalid configuration: ${validation.error}`,
        }));
    }
    return async (c, next) => {
        const request = c.req;
        if (isPreflightRequest(request)) {
            return handleCORSPreflight({ request, config });
        }
        const response = await next();
        if (!response)
            return response;
        return (await applyCORSHeaders({ request, response, config })) ?? response;
    };
}
export function corsSimple(origin = "*") {
    return cors({
        origin,
        credentials: false,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });
}
