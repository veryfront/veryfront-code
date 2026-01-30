/**
 * HTTP client for pulling runtime data from the Veryfront dev server's Dashboard API.
 *
 * Used by the standalone `veryfront mcp` process to access ErrorCollector,
 * LogBuffer, and HMR data over HTTP from the user's running `veryfront` process.
 */
import * as dntShim from "../../../_dnt.shims.js";
const REQUEST_TIMEOUT_MS = 3000;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [200, 500];
export class DevServerClient {
    baseUrl;
    constructor(options) {
        this.baseUrl = `http://localhost:${options.port}`;
    }
    /**
     * Fetch live errors from the ErrorCollector.
     */
    getLiveErrors(type) {
        const params = type ? `?type=${encodeURIComponent(type)}` : "";
        return this.pull(`/_dev/api/live-errors${params}`);
    }
    /**
     * Fetch live logs from the LogBuffer.
     */
    getLiveLogs(options) {
        const params = new URLSearchParams();
        if (options?.level)
            params.set("level", options.level);
        if (options?.source)
            params.set("source", options.source);
        if (options?.pattern)
            params.set("pattern", options.pattern);
        if (options?.limit)
            params.set("limit", String(options.limit));
        if (options?.since)
            params.set("since", String(options.since));
        const qs = params.toString();
        return this.pull(`/_dev/api/live-logs${qs ? `?${qs}` : ""}`);
    }
    /**
     * Fetch dev server stats.
     */
    getStats() {
        return this.pull("/_dev/api/stats");
    }
    /**
     * Trigger HMR reload.
     */
    triggerHmr(path) {
        return this.pull("/_dev/api/hmr-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(path ? { path } : {}),
        });
    }
    /**
     * Fetch with retry and exponential backoff.
     * Retries on connection refused / timeout (dev server may be starting up).
     */
    async pull(path, init) {
        let lastError;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await dntShim.fetch(`${this.baseUrl}${path}`, {
                    ...init,
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
                return await response.json();
            }
            catch (error) {
                lastError = error;
                if (attempt < MAX_RETRIES) {
                    await new Promise((r) => dntShim.setTimeout(r, RETRY_DELAYS_MS[attempt]));
                }
            }
        }
        throw lastError;
    }
}
