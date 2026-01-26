export type { MetricsState, ObservabilityMetrics, OtelInstruments, RSCRequestKind, VeryfrontMetrics, } from "./types.js";
export { getObservabilityMetrics, resetObservabilityLoader } from "./observability-loader.js";
export { ensureOtelInstruments, getOtelInstruments, resetOtelInstruments, safeLogWarn, safeOtelOperation, } from "./otel-instruments.js";
export { createSnapshot, getRequestCount, getSSRBoundaries, resetMetrics, state, } from "./metrics-state.js";
export { incRequest, recordApiRequest, recordApiRetry, recordCacheGet, recordCacheInvalidate, recordCacheSet, recordCorsRejection, recordHttp, recordRSC, recordRSCStreamDuration, recordSecurityHeaders, recordSSR, } from "./metrics-recorder.js";
import { incRequest, recordApiRequest, recordApiRetry, recordCacheGet, recordCacheInvalidate, recordCacheSet, recordCorsRejection, recordHttp, recordRSC, recordRSCStreamDuration, recordSecurityHeaders, recordSSR } from "./metrics-recorder.js";
import { createSnapshot, getRequestCount, resetMetrics } from "./metrics-state.js";
export declare const metrics: {
    incRequest: typeof incRequest;
    recordHttp: typeof recordHttp;
    recordCacheGet: typeof recordCacheGet;
    recordCacheSet: typeof recordCacheSet;
    recordCacheInvalidate: typeof recordCacheInvalidate;
    recordSSR: typeof recordSSR;
    recordRSCStreamDuration: typeof recordRSCStreamDuration;
    recordRSC: typeof recordRSC;
    recordCorsRejection: typeof recordCorsRejection;
    recordSecurityHeaders: typeof recordSecurityHeaders;
    recordApiRequest: typeof recordApiRequest;
    recordApiRetry: typeof recordApiRetry;
    snapshot: typeof createSnapshot;
    reset: typeof resetMetrics;
    getRequestCount: typeof getRequestCount;
};
//# sourceMappingURL=index.d.ts.map