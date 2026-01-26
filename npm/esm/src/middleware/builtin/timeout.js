import * as dntShim from "../../../_dnt.shims.js";
import { getRequest } from "./types.js";
import { serverLogger } from "../../utils/index.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
const DEFAULT_TIMEOUT_MS = 60000;
const HTTP_GATEWAY_TIMEOUT = 504;
const TIMEOUT_SENTINEL = Symbol("timeout");
/**
 * Creates a middleware that enforces request timeouts.
 *
 * If a request takes longer than the configured timeout, the middleware
 * returns a 504 Gateway Timeout response.
 */
export function timeout(options) {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const message = options?.message ?? "Request timeout";
    const exclude = options?.exclude ?? ["/healthz", "/readyz", "/_health"];
    return async (ctx, next) => {
        const req = getRequest(ctx);
        const { pathname } = new URL(req.url);
        if (exclude.some((path) => pathname === path || pathname.startsWith(path))) {
            return next();
        }
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = dntShim.setTimeout(() => reject(TIMEOUT_SENTINEL), timeoutMs);
        });
        try {
            const result = await Promise.race([next(), timeoutPromise]);
            if (timeoutId)
                clearTimeout(timeoutId);
            return result;
        }
        catch (error) {
            if (timeoutId)
                clearTimeout(timeoutId);
            if (error !== TIMEOUT_SENTINEL) {
                throw error;
            }
            serverLogger.warn("[timeout] Request timed out", {
                path: pathname,
                method: req.method,
                timeoutMs,
            });
            return new dntShim.Response(JSON.stringify({
                error: message,
                timeoutMs,
                path: pathname,
            }), {
                status: HTTP_GATEWAY_TIMEOUT,
                headers: { "Content-Type": "application/json" },
            });
        }
    };
}
/**
 * Gets timeout from environment variable REQUEST_TIMEOUT_MS
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
export function getTimeoutFromEnv(env = getRuntimeEnv()) {
    const timeoutMs = env.requestTimeoutMs;
    if (timeoutMs && timeoutMs > 0)
        return timeoutMs;
    return DEFAULT_TIMEOUT_MS;
}
/**
 * Creates a timeout middleware with configuration from environment
 */
export function timeoutFromEnv(options) {
    return timeout({ ...options, timeoutMs: getTimeoutFromEnv() });
}
