/**
 * Metrics recording operations
 * @module
 */
import { getSSRBoundaries, state } from "./metrics-state.js";
import { getObservabilityMetrics } from "./observability-loader.js";
import { getOtelInstruments, safeOtelOperation } from "./otel-instruments.js";
function recordObservability(fn) {
    void getObservabilityMetrics()
        .then((obs) => fn(obs))
        .catch(() => {
        /* metrics recording failure - non-critical */
    });
}
/**
 * Increment request counter
 *
 * @example
 * ```ts
 * await incRequest()
 * ```
 */
export async function incRequest() {
    state.requests++;
    const obs = await getObservabilityMetrics();
    obs?.recordHttpRequest();
    const otel = getOtelInstruments();
    await safeOtelOperation(() => otel.requestCounter?.add(1), "incRequest counter add failed");
}
/**
 * Record HTTP request statistics
 *
 * @param resolved - Number of resolved requests
 * @param blocked - Number of blocked requests
 * @param fetchMsTotal - Total fetch time in milliseconds
 *
 * @example
 * ```ts
 * recordHttp(10, 2, 150)
 * ```
 */
export function recordHttp(resolved, blocked, fetchMsTotal) {
    state.jitHttpResolved += resolved;
    state.jitHttpBlocked += blocked;
    state.jitHttpFetchMsTotal += Math.floor(fetchMsTotal);
    const otel = getOtelInstruments();
    void safeOtelOperation(() => {
        if (resolved)
            otel.jitResolvedCounter?.add(resolved);
        if (blocked)
            otel.jitBlockedCounter?.add(blocked);
    }, "HTTP counters add failed");
}
/**
 * Record cache get operation
 *
 * @param hit - Whether the cache hit or missed
 *
 * @example
 * ```ts
 * recordCacheGet(true) // cache hit
 * recordCacheGet(false) // cache miss
 * ```
 */
export function recordCacheGet(hit) {
    state.cacheGets++;
    if (hit)
        state.cacheHits++;
    else
        state.cacheMisses++;
    recordObservability((obs) => obs?.recordCacheGet(hit));
    const otel = getOtelInstruments();
    void safeOtelOperation(() => {
        otel.cacheGetCounter?.add(1);
        if (hit)
            otel.cacheHitCounter?.add(1);
        else
            otel.cacheMissCounter?.add(1);
    }, "cache get counters add failed");
}
/**
 * Record cache set operation
 *
 * @example
 * ```ts
 * recordCacheSet()
 * ```
 */
export function recordCacheSet() {
    state.cacheSets++;
    recordObservability((obs) => obs?.recordCacheSet());
    const otel = getOtelInstruments();
    void safeOtelOperation(() => otel.cacheSetCounter?.add(1), "cache set counter add failed");
}
/**
 * Record cache invalidation
 *
 * @param n - Number of entries invalidated
 *
 * @example
 * ```ts
 * recordCacheInvalidate(5)
 * ```
 */
export function recordCacheInvalidate(n) {
    const count = n | 0;
    state.cacheInvalidations += count;
    recordObservability((obs) => obs?.recordCacheInvalidate(count));
    const otel = getOtelInstruments();
    void safeOtelOperation(() => otel.cacheInvalidateCounter?.add(count), "cache invalidate counter add failed");
}
/**
 * Record SSR render duration
 *
 * @param durationMs - Duration in milliseconds
 *
 * @example
 * ```ts
 * recordSSR(150)
 * ```
 */
export function recordSSR(durationMs) {
    const d = Math.max(0, Math.floor(durationMs));
    const boundaries = getSSRBoundaries();
    let idx = boundaries.findIndex((b) => d <= b);
    if (idx === -1)
        idx = state._ssrCounts.length - 1;
    const currentCount = state._ssrCounts[idx];
    if (currentCount !== undefined)
        state._ssrCounts[idx] = currentCount + 1;
    recordObservability((obs) => obs?.recordRender(d));
    const otel = getOtelInstruments();
    void safeOtelOperation(() => otel.ssrHistogram?.record(d), "ssr histogram record failed");
}
/**
 * Record RSC stream duration
 *
 * @param durationMs - Duration in milliseconds
 *
 * @example
 * ```ts
 * recordRSCStreamDuration(200)
 * ```
 */
export function recordRSCStreamDuration(durationMs) {
    const boundaries = getSSRBoundaries();
    const d = Math.max(0, Math.floor(durationMs));
    if (!state.rscStreamHistogram) {
        state.rscStreamHistogram = {
            boundaries: [...boundaries],
            counts: Array.from({ length: boundaries.length + 1 }, () => 0),
        };
    }
    let idx = boundaries.findIndex((b) => d <= b);
    if (idx === -1)
        idx = state.rscStreamHistogram.counts.length - 1;
    const rscCount = state.rscStreamHistogram.counts[idx];
    if (rscCount !== undefined)
        state.rscStreamHistogram.counts[idx] = rscCount + 1;
    recordObservability((obs) => obs?.recordRSCStream(d));
}
function recordObservabilityRSC(obsKind) {
    recordObservability((obs) => obs?.recordRSCRequest(obsKind));
}
/** RSC kind to state property and observability kind mapping */
const RSC_KIND_MAP = {
    manifest: { prop: "rscManifest", obs: "manifest" },
    page: { prop: "rscPage", obs: "page" },
    flight_page: { prop: "rscPage", obs: "page" },
    stream: { prop: "rscStream", obs: "stream" },
    action: { prop: "rscAction", obs: "action" },
    error: { prop: "rscErrors" },
};
/**
 * Record RSC endpoint request
 *
 * @param kind - Type of RSC request
 *
 * @example
 * ```ts
 * recordRSC('page')
 * recordRSC('manifest')
 * ```
 */
export function recordRSC(kind) {
    const mapping = RSC_KIND_MAP[kind];
    state[mapping.prop]++;
    if (mapping.obs)
        recordObservabilityRSC(mapping.obs);
}
/**
 * Record CORS rejection
 *
 * @example
 * ```ts
 * recordCorsRejection()
 * ```
 */
export function recordCorsRejection() {
    state.corsRejections++;
}
/**
 * Record security headers application
 *
 * @example
 * ```ts
 * recordSecurityHeaders()
 * ```
 */
export function recordSecurityHeaders() {
    state.securityHeadersApplied++;
}
export function recordApiRequest(status) {
    if (status >= 200 && status < 300) {
        state.apiRequests2xx++;
        return;
    }
    if (status >= 400 && status < 500) {
        state.apiRequests4xx++;
        return;
    }
    if (status >= 500)
        state.apiRequests5xx++;
}
export function recordApiRetry() {
    state.apiRetries++;
}
