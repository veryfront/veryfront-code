
import { getSSRBoundaries, state } from "./metrics-state.ts";
import { getObservabilityMetrics } from "./observability-loader.ts";
import { getOtelInstruments, safeOtelOperation } from "./otel-instruments.ts";
import type { RSCRequestKind } from "./types.ts";

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

  void getObservabilityMetrics().then((obs) => obs?.recordCacheGet(hit)).catch(() => {
  });
  const otel = getOtelInstruments();
  void safeOtelOperation(() => {
    otel.cacheGetCounter?.add(1);
    if (hit) otel.cacheHitCounter?.add(1);
    else otel.cacheMissCounter?.add(1);
  }, "cache get counters add failed");
}

export function recordCacheSet(): void {
  state.cacheSets++;
  void getObservabilityMetrics().then((obs) => obs?.recordCacheSet()).catch(() => {
  });
  const otel = getOtelInstruments();
  void safeOtelOperation(() => otel.cacheSetCounter?.add(1), "cache set counter add failed");
}

export function recordCacheInvalidate(n: number): void {
  state.cacheInvalidations += n | 0;
  void getObservabilityMetrics().then((obs) => obs?.recordCacheInvalidate(n | 0)).catch(() => {
  });
  const otel = getOtelInstruments();
  void safeOtelOperation(
    () => otel.cacheInvalidateCounter?.add(n | 0),
    "cache invalidate counter add failed",
  );
}

export function recordSSR(durationMs: number): void {
  const d = Math.max(0, Math.floor(durationMs));
  const boundaries = getSSRBoundaries();
  let idx = boundaries.findIndex((b) => d <= b);
  if (idx === -1) idx = state._ssrCounts.length - 1;
  state._ssrCounts[idx]! += 1;

  void getObservabilityMetrics().then((obs) => obs?.recordRender(d)).catch(() => {
  });
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

  void getObservabilityMetrics().then((obs) => obs?.recordRSCStream(d)).catch(() => {
  });
}

export function recordRSC(kind: RSCRequestKind): void {
  switch (kind) {
    case "manifest":
      state.rscManifest++;
      void getObservabilityMetrics().then((obs) => obs?.recordRSCRequest("manifest")).catch(() => {
      });
      break;
    case "page":
      state.rscPage++;
      void getObservabilityMetrics().then((obs) => obs?.recordRSCRequest("page")).catch(() => {
      });
      break;
    case "flight_page":
      state.rscPage++;
      void getObservabilityMetrics().then((obs) => obs?.recordRSCRequest("page")).catch(() => {
      });
      break;
    case "stream":
      state.rscStream++;
      void getObservabilityMetrics().then((obs) => obs?.recordRSCRequest("stream")).catch(() => {
      });
      break;
    case "action":
      state.rscAction++;
      void getObservabilityMetrics().then((obs) => obs?.recordRSCRequest("action")).catch(() => {
      });
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
