/**
 * Metrics recording operations
 * @module
 */

import { getSSRBoundaries, state } from "./metrics-state.ts";
import { getObservabilityMetrics } from "./observability-loader.ts";
import { getOtelInstruments, safeOtelOperation } from "./otel-instruments.ts";
import type { RSCRequestKind } from "./types.ts";

function recordObservability(
  fn: (obs: Awaited<ReturnType<typeof getObservabilityMetrics>>) => void,
): void {
  void (async () => {
    try {
      const obs = await getObservabilityMetrics();
      fn(obs);
    } catch {
      /* metrics recording failure - non-critical */
    }
  })();
}

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

  recordObservability((obs) => obs?.recordCacheGet(hit));

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
export function recordCacheInvalidate(n: number): void {
  const count = n | 0;
  state.cacheInvalidations += count;

  recordObservability((obs) => obs?.recordCacheInvalidate(count));

  const otel = getOtelInstruments();
  void safeOtelOperation(
    () => otel.cacheInvalidateCounter?.add(count),
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

  state._ssrCounts[idx] = (state._ssrCounts[idx] ?? 0) + 1;

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
export function recordRSCStreamDuration(durationMs: number): void {
  const boundaries = getSSRBoundaries();
  const d = Math.max(0, Math.floor(durationMs));

  state.rscStreamHistogram ??= {
    boundaries: [...boundaries],
    counts: Array.from({ length: boundaries.length + 1 }, () => 0),
  };

  let idx = boundaries.findIndex((b) => d <= b);
  if (idx === -1) idx = state.rscStreamHistogram.counts.length - 1;

  state.rscStreamHistogram.counts[idx] = (state.rscStreamHistogram.counts[idx] ?? 0) + 1;

  recordObservability((obs) => obs?.recordRSCStream(d));
}

type ObservabilityRSCKind = "manifest" | "page" | "stream" | "action";

function recordObservabilityRSC(obsKind: ObservabilityRSCKind): void {
  recordObservability((obs) => obs?.recordRSCRequest(obsKind));
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
  const { prop, obs } = RSC_KIND_MAP[kind];
  state[prop]++;
  if (obs) recordObservabilityRSC(obs);
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
    return;
  }

  if (status >= 400 && status < 500) {
    state.apiRequests4xx++;
    return;
  }

  if (status >= 500) state.apiRequests5xx++;
}

export function recordApiRetry(): void {
  state.apiRetries++;
}

// ============================================================================
// Content Cache Metrics - Track cache behavior for file reads
// ============================================================================

import { getContentNetworkBoundaries } from "./metrics-state.ts";

export type ContentCacheLayer = "request" | "persistent" | "filelist";

/**
 * Record a content cache hit at the specified layer
 *
 * @param layer - Which cache layer served the content
 *
 * @example
 * ```ts
 * recordContentCacheHit("request")   // L1 request-scoped cache
 * recordContentCacheHit("persistent") // L2 persistent cache
 * recordContentCacheHit("filelist")   // L3 file list cache
 * ```
 */
export function recordContentCacheHit(layer: ContentCacheLayer): void {
  switch (layer) {
    case "request":
      state.contentRequestScopedHits++;
      break;
    case "persistent":
      state.contentPersistentCacheHits++;
      break;
    case "filelist":
      state.contentFileListHits++;
      break;
  }
}

/**
 * Record a content network fetch with timing
 *
 * @param durationMs - Time taken for the network fetch
 * @param isPreview - Whether this is a preview mode request
 *
 * @example
 * ```ts
 * recordContentNetworkFetch(150, true)  // preview mode fetch
 * recordContentNetworkFetch(80, false)  // production mode fetch
 * ```
 */
export function recordContentNetworkFetch(durationMs: number, isPreview: boolean): void {
  const d = Math.max(0, Math.floor(durationMs));
  const boundaries = getContentNetworkBoundaries();

  // Update counters
  state.contentNetworkFetches++;
  state.contentNetworkFetchMsTotal += d;

  // Track preview vs production
  if (isPreview) {
    state.contentPreviewRequests++;
  } else {
    state.contentProductionRequests++;
  }

  // Update histogram
  let idx = boundaries.findIndex((b) => d <= b);
  if (idx === -1) idx = state._contentNetworkCounts.length - 1;
  state._contentNetworkCounts[idx] = (state._contentNetworkCounts[idx] ?? 0) + 1;
}
