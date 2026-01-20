/**
 * Metrics recording operations
 * @module
 */

import { getSSRBoundaries, state } from "./metrics-state.ts";
import { getObservabilityMetrics } from "./observability-loader.ts";
import { getOtelInstruments, safeOtelOperation } from "./otel-instruments.ts";
import type { RSCRequestKind } from "./types.ts";

/**
 * Increment request counter
 *
 * @example
 * ```ts
 * await incRequest()
 * ```
 */
export async function incRequest(): Promise<void> {
  state.requests++;
  const obs = await getObservabilityMetrics();
  obs?.recordHttpRequest(); // Use new observability layer (optional)
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
export function recordHttp(resolved: number, blocked: number, fetchMsTotal: number): void {
  state.jitHttpResolved += resolved;
  state.jitHttpBlocked += blocked;
  state.jitHttpFetchMsTotal += Math.floor(fetchMsTotal);

  const otel = getOtelInstruments();
  void safeOtelOperation(() => {
    if (resolved) otel.jitResolvedCounter?.add(resolved);
    if (blocked) otel.jitBlockedCounter?.add(blocked);
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
export function recordCacheGet(hit: boolean): void {
  state.cacheGets++;
  if (hit) state.cacheHits++;
  else state.cacheMisses++;

  void getObservabilityMetrics().then((obs) => obs?.recordCacheGet(hit)).catch(() => {
    /* metrics recording failure - non-critical */
  });
  const otel = getOtelInstruments();
  void safeOtelOperation(() => {
    otel.cacheGetCounter?.add(1);
    if (hit) otel.cacheHitCounter?.add(1);
    else otel.cacheMissCounter?.add(1);
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
export function recordCacheSet(): void {
  state.cacheSets++;
  void getObservabilityMetrics().then((obs) => obs?.recordCacheSet()).catch(() => {
    /* metrics recording failure - non-critical */
  });
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
export function recordCacheInvalidate(n: number): void {
  state.cacheInvalidations += n | 0;
  void getObservabilityMetrics().then((obs) => obs?.recordCacheInvalidate(n | 0)).catch(() => {
    /* metrics recording failure - non-critical */
  });
  const otel = getOtelInstruments();
  void safeOtelOperation(
    () => otel.cacheInvalidateCounter?.add(n | 0),
    "cache invalidate counter add failed",
  );
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
export function recordSSR(durationMs: number): void {
  const d = Math.max(0, Math.floor(durationMs));
  const boundaries = getSSRBoundaries();
  let idx = boundaries.findIndex((b) => d <= b);
  if (idx === -1) idx = state._ssrCounts.length - 1;
  state._ssrCounts[idx]! += 1;

  void getObservabilityMetrics().then((obs) => obs?.recordRender(d)).catch(() => {
    /* metrics recording failure - non-critical */
  });
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
export function recordRSCStreamDuration(durationMs: number): void {
  const boundaries = getSSRBoundaries();
  const d = Math.max(0, Math.floor(durationMs));
  // Initialize if first use
  if (!state.rscStreamHistogram) {
    state.rscStreamHistogram = {
      boundaries: [...boundaries],
      counts: Array.from({ length: boundaries.length + 1 }, () => 0),
    };
  }
  let idx = boundaries.findIndex((b) => d <= b);
  if (idx === -1) idx = state.rscStreamHistogram.counts.length - 1;
  state.rscStreamHistogram.counts[idx]! += 1;

  void getObservabilityMetrics().then((obs) => obs?.recordRSCStream(d)).catch(() => {
    /* metrics recording failure - non-critical */
  });
}

type ObservabilityRSCKind = "manifest" | "page" | "stream" | "action";

function recordObservabilityRSC(obsKind: ObservabilityRSCKind): void {
  void getObservabilityMetrics().then((obs) => obs?.recordRSCRequest(obsKind)).catch(() => {
    /* metrics recording failure - non-critical */
  });
}

/** RSC kind to state property and observability kind mapping */
const RSC_KIND_MAP: Record<
  RSCRequestKind,
  { prop: keyof typeof state; obs?: ObservabilityRSCKind }
> = {
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
export function recordRSC(kind: RSCRequestKind): void {
  const mapping = RSC_KIND_MAP[kind];
  if (mapping) {
    (state[mapping.prop] as number)++;
    if (mapping.obs) recordObservabilityRSC(mapping.obs);
  }
}

/**
 * Record CORS rejection
 *
 * @example
 * ```ts
 * recordCorsRejection()
 * ```
 */
export function recordCorsRejection(): void {
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
export function recordSecurityHeaders(): void {
  state.securityHeadersApplied++;
}

export function recordApiRequest(status: number): void {
  if (status >= 200 && status < 300) {
    state.apiRequests2xx++;
  } else if (status >= 400 && status < 500) {
    state.apiRequests4xx++;
  } else if (status >= 500) {
    state.apiRequests5xx++;
  }
}

export function recordApiRetry(): void {
  state.apiRetries++;
}
