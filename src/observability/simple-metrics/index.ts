
export type {
  MetricsState,
  ObservabilityMetrics,
  OtelInstruments,
  RSCRequestKind,
  VeryfrontMetrics,
} from "./types.ts";

export { getObservabilityMetrics, resetObservabilityLoader } from "./observability-loader.ts";
export {
  ensureOtelInstruments,
  getOtelInstruments,
  resetOtelInstruments,
  safeLogWarn,
  safeOtelOperation,
} from "./otel-instruments.ts";
export {
  createSnapshot,
  getRequestCount,
  getSSRBoundaries,
  resetMetrics,
  state,
} from "./metrics-state.ts";
export {
  incRequest,
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  recordCorsRejection,
  recordHttp,
  recordRSC,
  recordRSCStreamDuration,
  recordSecurityHeaders,
  recordSSR,
} from "./metrics-recorder.ts";

import {
  incRequest,
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  recordCorsRejection,
  recordHttp,
  recordRSC,
  recordRSCStreamDuration,
  recordSecurityHeaders,
  recordSSR,
} from "./metrics-recorder.ts";
import { createSnapshot, getRequestCount, resetMetrics } from "./metrics-state.ts";

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
  snapshot: createSnapshot,
  reset: resetMetrics,
  getRequestCount,
};
