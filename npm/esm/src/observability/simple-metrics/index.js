export { getObservabilityMetrics, resetObservabilityLoader } from "./observability-loader.js";
export { ensureOtelInstruments, getOtelInstruments, resetOtelInstruments, safeLogWarn, safeOtelOperation, } from "./otel-instruments.js";
export { createSnapshot, getRequestCount, getSSRBoundaries, resetMetrics, state, } from "./metrics-state.js";
export { incRequest, recordApiRequest, recordApiRetry, recordCacheGet, recordCacheInvalidate, recordCacheSet, recordCorsRejection, recordHttp, recordRSC, recordRSCStreamDuration, recordSecurityHeaders, recordSSR, } from "./metrics-recorder.js";
import { incRequest, recordApiRequest, recordApiRetry, recordCacheGet, recordCacheInvalidate, recordCacheSet, recordCorsRejection, recordHttp, recordRSC, recordRSCStreamDuration, recordSecurityHeaders, recordSSR, } from "./metrics-recorder.js";
import { createSnapshot, getRequestCount, resetMetrics } from "./metrics-state.js";
export const metrics = {
    incRequest,
    recordHttp,
    recordCacheGet,
    recordCacheSet,
    recordCacheInvalidate,
    recordSSR,
    recordRSCStreamDuration,
    recordRSC,
    recordCorsRejection,
    recordSecurityHeaders,
    recordApiRequest,
    recordApiRetry,
    snapshot: createSnapshot,
    reset: resetMetrics,
    getRequestCount,
};
