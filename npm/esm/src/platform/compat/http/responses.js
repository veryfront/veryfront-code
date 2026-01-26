import * as dntShim from "../../../../_dnt.shims.js";
export const HttpStatus = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    MOVED_PERMANENTLY: 301,
    FOUND: 302,
    NOT_MODIFIED: 304,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
};
function withCorrelationId(headers, options) {
    const correlationId = options?.correlationId;
    if (correlationId)
        headers.set("X-Correlation-Id", correlationId);
}
export function errorResponse(status, message, options) {
    const statusText = getStatusText(status);
    const body = message ?? statusText;
    const headers = new dntShim.Headers(options?.headers);
    headers.set("Content-Type", "text/plain; charset=utf-8");
    withCorrelationId(headers, options);
    return new dntShim.Response(body, {
        ...options,
        status,
        statusText,
        headers,
    });
}
export function jsonResponse(data, status = HttpStatus.OK, options) {
    const headers = new dntShim.Headers(options?.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    withCorrelationId(headers, options);
    try {
        return new dntShim.Response(JSON.stringify(data), {
            ...options,
            status,
            headers,
        });
    }
    catch {
        return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to serialize response data");
    }
}
export function redirectResponse(url, permanent = false, options) {
    if (!isValidRedirectUrl(url)) {
        return errorResponse(HttpStatus.BAD_REQUEST, "Invalid redirect URL");
    }
    const status = permanent ? HttpStatus.MOVED_PERMANENTLY : HttpStatus.FOUND;
    const headers = new dntShim.Headers(options?.headers);
    headers.set("Location", url);
    withCorrelationId(headers, options);
    return new dntShim.Response(null, {
        ...options,
        status,
        headers,
    });
}
export function notFound(message, options) {
    return errorResponse(HttpStatus.NOT_FOUND, message, options);
}
export function badRequest(message, options) {
    return errorResponse(HttpStatus.BAD_REQUEST, message, options);
}
export function unauthorized(message, options) {
    return errorResponse(HttpStatus.UNAUTHORIZED, message, options);
}
export function forbidden(message, options) {
    return errorResponse(HttpStatus.FORBIDDEN, message, options);
}
export function internalServerError(message, options) {
    return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, message, options);
}
export function badGateway(message, options) {
    return errorResponse(HttpStatus.BAD_GATEWAY, message, options);
}
export function serviceUnavailable(message, options) {
    return errorResponse(HttpStatus.SERVICE_UNAVAILABLE, message, options);
}
export function methodNotAllowed(allowed, options) {
    const allow = allowed.join(", ");
    const headers = new dntShim.Headers(options?.headers);
    headers.set("Allow", allow);
    withCorrelationId(headers, options);
    return errorResponse(HttpStatus.METHOD_NOT_ALLOWED, `Method not allowed. Allowed methods: ${allow}`, { ...options, headers });
}
export function ok(data, options) {
    if (data === undefined)
        return new dntShim.Response(null, { status: HttpStatus.OK, ...options });
    return jsonResponse(data, HttpStatus.OK, options);
}
export function created(data, location, options) {
    const headers = new dntShim.Headers(options?.headers);
    if (location)
        headers.set("Location", location);
    withCorrelationId(headers, options);
    if (data === undefined) {
        return new dntShim.Response(null, { status: HttpStatus.CREATED, headers, ...options });
    }
    return jsonResponse(data, HttpStatus.CREATED, { ...options, headers });
}
export function noContent(options) {
    return new dntShim.Response(null, { status: HttpStatus.NO_CONTENT, ...options });
}
export function jsonErrorResponse(status, error, options) {
    const headers = new dntShim.Headers(options?.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    withCorrelationId(headers, options);
    return new dntShim.Response(JSON.stringify({ ok: false, error }), {
        ...options,
        status,
        headers,
    });
}
function getStatusText(status) {
    const statusTexts = {
        [HttpStatus.OK]: "OK",
        [HttpStatus.CREATED]: "Created",
        [HttpStatus.NO_CONTENT]: "No Content",
        [HttpStatus.MOVED_PERMANENTLY]: "Moved Permanently",
        [HttpStatus.FOUND]: "Found",
        [HttpStatus.NOT_MODIFIED]: "Not Modified",
        [HttpStatus.BAD_REQUEST]: "Bad Request",
        [HttpStatus.UNAUTHORIZED]: "Unauthorized",
        [HttpStatus.FORBIDDEN]: "Forbidden",
        [HttpStatus.NOT_FOUND]: "Not Found",
        [HttpStatus.METHOD_NOT_ALLOWED]: "Method Not Allowed",
        [HttpStatus.CONFLICT]: "Conflict",
        [HttpStatus.UNPROCESSABLE_ENTITY]: "Unprocessable Entity",
        [HttpStatus.TOO_MANY_REQUESTS]: "Too Many Requests",
        [HttpStatus.INTERNAL_SERVER_ERROR]: "Internal Server Error",
        [HttpStatus.NOT_IMPLEMENTED]: "Not Implemented",
        [HttpStatus.BAD_GATEWAY]: "Bad Gateway",
        [HttpStatus.SERVICE_UNAVAILABLE]: "Service Unavailable",
        [HttpStatus.GATEWAY_TIMEOUT]: "Gateway Timeout",
    };
    return statusTexts[status] ?? "Unknown Status";
}
function isValidRedirectUrl(url) {
    try {
        const parsed = new URL(url, "http://localhost");
        if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) {
            return true;
        }
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch {
        return false;
    }
}
