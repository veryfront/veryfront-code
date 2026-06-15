/**
 * Observability Simple Metrics
 *
 * @module observability/simple-metrics
 */

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
  recordApiRequest,
  recordApiRetry,
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  recordContentCacheHit,
  recordContentNetworkFetch,
  recordCorsRejection,
  recordHttp,
  recordModuleServe,
  recordModuleTransform,
  recordRouteManifestLookup,
  recordRSC,
  recordRSCStreamDuration,
  recordSecurityHeaders,
  recordSSR,
} from "./metrics-recorder.ts";

export type { ContentCacheLayer, ModuleServeStatus } from "./metrics-recorder.ts";

import {
  incRequest,
  recordApiRequest,
  recordApiRetry,
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  recordContentCacheHit,
  recordContentNetworkFetch,
  recordCorsRejection,
  recordHttp,
  recordModuleServe,
  recordModuleTransform,
  recordRouteManifestLookup,
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
  recordApiRequest,
  recordApiRetry,
  recordContentCacheHit,
  recordContentNetworkFetch,
  recordModuleServe,
  recordModuleTransform,
  recordRouteManifestLookup,
  snapshot: createSnapshot,
  reset: resetMetrics,
  getRequestCount,
};
