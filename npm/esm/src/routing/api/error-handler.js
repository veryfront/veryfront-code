import { isDevelopmentEnvironment, serverLogger as logger } from "../../utils/index.js";
import { HttpStatus, internalServerError, jsonResponse } from "../../platform/compat/http/responses.js";
function isDevelopment(adapter) {
    const env = adapter.env.get("MODE") ??
        adapter.env.get("NODE_ENV") ??
        adapter.env.get("DENO_ENV");
    if (!env)
        return isDevelopmentEnvironment();
    const normalized = env.toLowerCase();
    return normalized === "development" || normalized === "dev";
}
export function handleAPIError(error, pathname, adapter) {
    logger.error(`API route error in ${pathname}:`, error);
    if (!isDevelopment(adapter))
        return internalServerError();
    const err = error instanceof Error ? error : undefined;
    return jsonResponse({
        error: err?.message ?? "Internal server error",
        stack: err?.stack,
    }, HttpStatus.INTERNAL_SERVER_ERROR);
}
