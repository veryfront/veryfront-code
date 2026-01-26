import { CONTENT_TYPES } from "./constants.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
let ResponseBuilderClass = null;
/** Set ResponseBuilder class reference (called by builder.ts to avoid circular deps) */
export function setResponseBuilderClass(builderClass) {
    ResponseBuilderClass = builderClass;
}
function createBuilder(req, config) {
    if (!ResponseBuilderClass) {
        throw toError(createError({
            type: "config",
            message: "ResponseBuilder class not initialized",
        }));
    }
    const builder = new ResponseBuilderClass(config);
    builder.withCORS(req, config?.corsConfig);
    if (config?.securityConfig !== undefined) {
        builder.withSecurity(config.securityConfig ?? undefined);
    }
    if (config?.cache) {
        builder.withCache(config.cache);
    }
    if (config?.etag) {
        builder.withETag(config.etag);
    }
    return builder;
}
export function error(status, message, req, config) {
    const builder = createBuilder(req, config);
    const contentType = config?.contentType ?? CONTENT_TYPES.TEXT;
    if (contentType === CONTENT_TYPES.JSON) {
        return builder.json({ error: message }, status);
    }
    if (contentType === CONTENT_TYPES.HTML) {
        return builder.html(message, status);
    }
    return builder.text(message, status);
}
export function json(data, req, config) {
    return createBuilder(req, config).json(data, config?.status);
}
export function html(body, req, config) {
    return createBuilder(req, config).html(body, config?.status);
}
export function preflight(req, config) {
    const builder = createBuilder(req, config);
    builder.withAllow(config?.allowMethods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    const headers = config?.allowHeaders ??
        req.headers.get("access-control-request-headers") ??
        "Content-Type,Authorization";
    builder.headers.set("Access-Control-Allow-Headers", Array.isArray(headers) ? headers.join(", ") : headers);
    return builder.build(null, 204);
}
export function stream(streamData, req, config) {
    const builder = createBuilder(req, config);
    return builder.withContentType(config?.contentType ?? "application/octet-stream", streamData);
}
