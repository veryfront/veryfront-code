import * as dntShim from "../../../../_dnt.shims.js";
import { getRequest } from "../types.js";
import { HTTP_TOO_MANY_REQUESTS, MS_PER_MINUTE, MS_PER_SECOND, } from "../../../utils/constants/http.js";
import { CLEANUP_INTERVAL_MULTIPLIER } from "../../../utils/constants/cache.js";
import { unrefTimer } from "../../../platform/compat/process.js";
const DEFAULT_RATE_LIMIT_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE;
export class MemoryRateLimitStore {
    counts = new Map();
    cleanupInterval;
    constructor(windowMs) {
        const shouldSkipInterval = dntShim.dntGlobalThis.__vfDisableLruInterval === true;
        if (shouldSkipInterval)
            return;
        this.cleanupInterval = dntShim.setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.counts.entries()) {
                if (entry.resetAt < now)
                    this.counts.delete(key);
            }
        }, windowMs * CLEANUP_INTERVAL_MULTIPLIER);
        unrefTimer(this.cleanupInterval);
    }
    increment(key, windowMs) {
        const now = Date.now();
        let entry = this.counts.get(key);
        if (!entry || entry.resetAt < now) {
            entry = { count: 0, resetAt: now + windowMs };
            this.counts.set(key, entry);
        }
        entry.count++;
        return Promise.resolve(entry);
    }
    reset(key) {
        this.counts.delete(key);
        return Promise.resolve();
    }
    destroy() {
        if (!this.cleanupInterval)
            return;
        clearInterval(this.cleanupInterval);
    }
}
export function rateLimit(optionsOrMaxRequests, windowMsArg) {
    const options = typeof optionsOrMaxRequests === "number"
        ? { maxRequests: optionsOrMaxRequests, windowMs: windowMsArg }
        : optionsOrMaxRequests ?? {};
    const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_REQUESTS;
    const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    const store = options.store ?? new MemoryRateLimitStore(windowMs);
    const keyGenerator = options.keyGenerator ??
        ((req) => req.headers.get("x-forwarded-for") || "anonymous");
    return async (ctx, next) => {
        const req = getRequest(ctx);
        const key = keyGenerator(req);
        const entry = await store.increment(key, windowMs);
        if (entry.count > maxRequests) {
            const retryAfterSeconds = Math.ceil((entry.resetAt - Date.now()) / MS_PER_SECOND);
            return new dntShim.Response("Too Many Requests", {
                status: HTTP_TOO_MANY_REQUESTS,
                headers: { "Retry-After": String(retryAfterSeconds) },
            });
        }
        return next();
    };
}
