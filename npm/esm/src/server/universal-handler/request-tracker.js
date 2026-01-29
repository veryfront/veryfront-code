/**
 * In-flight request tracker for debugging stuck requests.
 *
 * Tracks active requests and logs warnings when requests exceed thresholds.
 * Helps identify when the event loop is blocked or requests are hanging.
 */
import * as dntShim from "../../../_dnt.shims.js";
import { serverLogger as logger } from "../../utils/index.js";
/** Threshold in ms before logging a warning about a slow request */
const SLOW_REQUEST_THRESHOLD_MS = 10_000; // 10 seconds
/** Threshold in ms before logging an error about a very slow request */
const VERY_SLOW_REQUEST_THRESHOLD_MS = 25_000; // 25 seconds
/** How often to log the current state of in-flight requests */
const STATUS_LOG_INTERVAL_MS = 30_000; // 30 seconds
class RequestTracker {
    inFlight = new Map();
    statusInterval;
    totalRequests = 0;
    totalCompleted = 0;
    totalTimedOut = 0;
    constructor() {
        this.startStatusLogging();
    }
    startStatusLogging() {
        this.statusInterval = dntShim.setInterval(() => {
            if (this.inFlight.size === 0)
                return;
            const now = performance.now();
            const requests = Array.from(this.inFlight.values()).map((r) => ({
                requestId: r.requestId,
                projectSlug: r.projectSlug,
                path: r.path,
                method: r.method,
                elapsedMs: Math.round(now - r.startTime),
            }));
            requests.sort((a, b) => b.elapsedMs - a.elapsedMs);
            logger.info("[RequestTracker] In-flight requests status", {
                inFlightCount: this.inFlight.size,
                totalRequests: this.totalRequests,
                totalCompleted: this.totalCompleted,
                totalTimedOut: this.totalTimedOut,
                requests: requests.slice(0, 10),
            });
        }, STATUS_LOG_INTERVAL_MS);
        // Don't block process exit (Deno doesn't support unref, but that's okay
        // since Deno automatically doesn't block on intervals/timeouts)
    }
    start(requestId, projectSlug, path, method, env, releaseId) {
        const startTime = performance.now();
        this.totalRequests++;
        const tracked = {
            requestId,
            projectSlug,
            path,
            method,
            startTime,
            env,
            releaseId,
        };
        tracked.slowTimer = dntShim.setTimeout(() => {
            const elapsedMs = Math.round(performance.now() - startTime);
            logger.warn("[RequestTracker] Slow request detected", {
                requestId,
                projectSlug,
                path,
                method,
                elapsedMs,
                inFlightCount: this.inFlight.size,
            });
            tracked.slowTimer = dntShim.setTimeout(() => {
                const elapsedMs = Math.round(performance.now() - startTime);
                logger.error("[RequestTracker] Very slow request - likely stuck", {
                    requestId,
                    projectSlug,
                    path,
                    method,
                    elapsedMs,
                    inFlightCount: this.inFlight.size,
                });
            }, VERY_SLOW_REQUEST_THRESHOLD_MS - SLOW_REQUEST_THRESHOLD_MS);
        }, SLOW_REQUEST_THRESHOLD_MS);
        this.inFlight.set(requestId, tracked);
        logger.debug("[RequestTracker] Request started", {
            requestId,
            projectSlug,
            path,
            method,
            inFlightCount: this.inFlight.size,
        });
    }
    complete(requestId, statusCode, timedOut = false) {
        const tracked = this.inFlight.get(requestId);
        if (!tracked)
            return;
        if (tracked.slowTimer)
            clearTimeout(tracked.slowTimer);
        this.inFlight.delete(requestId);
        const durationMs = Math.round(performance.now() - tracked.startTime);
        if (timedOut)
            this.totalTimedOut++;
        else
            this.totalCompleted++;
        // Skip logging internal module requests entirely (too noisy)
        const isModuleRequest = tracked.path.startsWith("/_vf_modules/") ||
            tracked.path.startsWith("/_veryfront/");
        if (isModuleRequest) {
            // Only log modules at debug level, and only if slow
            if (durationMs > 100) {
                logger.debug(`${tracked.method} ${tracked.path} ${statusCode} ${durationMs}ms`);
            }
            return;
        }
        logger.info(`${tracked.method} ${tracked.path} ${statusCode}`, {
            project_slug: tracked.projectSlug,
            request_url: tracked.path,
            durationMs,
            method: tracked.method,
            statusCode,
            env: tracked.env,
            release_id: tracked.releaseId,
        });
    }
    getInFlightCount() {
        return this.inFlight.size;
    }
    getInFlightRequests() {
        return Array.from(this.inFlight.values());
    }
    getStats() {
        return {
            inFlight: this.inFlight.size,
            total: this.totalRequests,
            completed: this.totalCompleted,
            timedOut: this.totalTimedOut,
        };
    }
    async waitForDrain(timeoutMs, pollIntervalMs = 100) {
        const startTime = Date.now();
        if (this.inFlight.size === 0) {
            logger.info("[RequestTracker] No in-flight requests, drain complete");
            return true;
        }
        logger.info("[RequestTracker] Waiting for in-flight requests to drain", {
            inFlightCount: this.inFlight.size,
            timeoutMs,
        });
        while (this.inFlight.size > 0) {
            const elapsedMs = Date.now() - startTime;
            if (elapsedMs >= timeoutMs) {
                const remainingRequests = Array.from(this.inFlight.values()).map((r) => ({
                    requestId: r.requestId,
                    projectSlug: r.projectSlug,
                    path: r.path,
                    method: r.method,
                    elapsedMs: Math.round(performance.now() - r.startTime),
                }));
                logger.warn("[RequestTracker] Drain timeout - forcing shutdown with in-flight requests", {
                    inFlightCount: this.inFlight.size,
                    timeoutMs,
                    remainingRequests: remainingRequests.slice(0, 10),
                });
                return false;
            }
            if (elapsedMs > 0 && elapsedMs % 5000 < pollIntervalMs) {
                logger.info("[RequestTracker] Drain progress", {
                    inFlightCount: this.inFlight.size,
                    elapsedMs,
                    remainingMs: timeoutMs - elapsedMs,
                });
            }
            await new Promise((resolve) => dntShim.setTimeout(resolve, pollIntervalMs));
        }
        logger.info("[RequestTracker] All requests drained successfully", {
            drainTimeMs: Date.now() - startTime,
        });
        return true;
    }
    shutdown() {
        if (this.statusInterval)
            clearInterval(this.statusInterval);
        for (const tracked of this.inFlight.values()) {
            if (tracked.slowTimer)
                clearTimeout(tracked.slowTimer);
        }
        this.inFlight.clear();
    }
}
export const requestTracker = new RequestTracker();
