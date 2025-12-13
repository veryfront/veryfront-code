
import { getSSRBoundaries, state } from "./metrics-state.ts";
import { getObservabilityMetrics } from "./observability-loader.ts";
import { getOtelInstruments, safeOtelOperation } from "./otel-instruments.ts";
import type { ObservabilityMetrics, RSCRequestKind } from "./types.ts";

/**
 * Safely record observability metrics without blocking or throwing.
 * Metrics recording failures are non-critical and silently ignored.
 */
function safeRecordObservability(
  fn: (obs: ObservabilityMetrics) => void,
): void {
  void getObservabilityMetrics()
    .then((obs) => {
      if (obs) fn(obs);
    })
    .catch(() => {
      // metrics recording failure - non-critical
    });
}

export async function incRequest(): Promise<void> {
  state.requests++;
  const obs = await getObservabilityMetrics();
  obs?.recordHttpRequest();
  const otel = getOtelInstruments();
  await safeOtelOperation(() => otel.requestCounter?.add(1), "incRequest counter add failed");
}

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

export function recordCacheGet(hit: boolean): void {
  state.cacheGets++;
  if (hit) state.cacheHits++;
  else state.cacheMisses++;

  safeRecordObservability((obs) => obs.recordCacheGet(hit));
  const otel = getOtelInstruments();
  void safeOtelOperation(() => {
    otel.cacheGetCounter?.add(1);
    if (hit) otel.cacheHitCounter?.add(1);
    else otel.cacheMissCounter?.add(1);
  }, "cache get counters add failed");
}

export function recordCacheSet(): void {
  state.cacheSets++;
  safeRecordObservability((obs) => obs.recordCacheSet());
  const otel = getOtelInstruments();
  void safeOtelOperation(() => otel.cacheSetCounter?.add(1), "cache set counter add failed");
}

export function recordCacheInvalidate(n: number): void {
  const count = n | 0;
  state.cacheInvalidations += count;
  safeRecordObservability((obs) => obs.recordCacheInvalidate(count));
  const otel = getOtelInstruments();
  void safeOtelOperation(
    () => otel.cacheInvalidateCounter?.add(count),
    "cache invalidate counter add failed",
  );
}

export function recordSSR(durationMs: number): void {
  const d = Math.max(0, Math.floor(durationMs));
  const boundaries = getSSRBoundaries();
  let idx = boundaries.findIndex((b) => d <= b);
  if (idx === -1) idx = state._ssrCounts.length - 1;
  state._ssrCounts[idx]! += 1;

  safeRecordObservability((obs) => obs.recordRender(d));
  const otel = getOtelInstruments();
  void safeOtelOperation(() => otel.ssrHistogram?.record(d), "ssr histogram record failed");
}

export function recordRSCStreamDuration(durationMs: number): void {
  const boundaries = getSSRBoundaries();
  const d = Math.max(0, Math.floor(durationMs));
  if (!state.rscStreamHistogram) {
    state.rscStreamHistogram = {
      boundaries: [...boundaries],
      counts: Array.from({ length: boundaries.length + 1 }, () => 0),
    };
  }
  let idx = boundaries.findIndex((b) => d <= b);
  if (idx === -1) idx = state.rscStreamHistogram.counts.length - 1;
  state.rscStreamHistogram.counts[idx]! += 1;

  safeRecordObservability((obs) => obs.recordRSCStream(d));
}

export function recordRSC(kind: RSCRequestKind): void {
  switch (kind) {
    case "manifest":
      state.rscManifest++;
      safeRecordObservability((obs) => obs.recordRSCRequest("manifest"));
      break;
    case "page":
    case "flight_page":
      state.rscPage++;
      safeRecordObservability((obs) => obs.recordRSCRequest("page"));
      break;
    case "stream":
      state.rscStream++;
      safeRecordObservability((obs) => obs.recordRSCRequest("stream"));
      break;
    case "action":
      state.rscAction++;
      safeRecordObservability((obs) => obs.recordRSCRequest("action"));
      break;
    case "error":
      state.rscErrors++;
      break;
  }
}

export function recordCorsRejection(): void {
  state.corsRejections++;
}

export function recordSecurityHeaders(): void {
  state.securityHeadersApplied++;
}
