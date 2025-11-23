/**
 * Veryfront metrics system
 *
 * This module provides comprehensive metrics tracking for Veryfront including:
 * - Request counting and HTTP statistics
 * - Cache operations (gets, hits, misses, sets, invalidations)
 * - SSR render duration histograms
 * - RSC endpoint tracking
 * - Optional OpenTelemetry integration
 * - Optional observability layer integration
 *
 * @module
 *
 * @example
 * ```ts
 * import { metrics } from './metrics/index.ts'
 *
 * // Record a request
 * await metrics.incRequest()
 *
 * // Record cache operations
 * metrics.recordCacheGet(true) // cache hit
 * metrics.recordCacheSet()
 *
 * // Record SSR render
 * metrics.recordSSR(150) // 150ms render
 *
 * // Get snapshot
 * const snapshot = metrics.snapshot()
 * console.log(snapshot.requests)
 * ```
 */

// Re-export types
export type {
  MetricsState,
  ObservabilityMetrics,
  OtelInstruments,
  RSCRequestKind,
  VeryfrontMetrics,
} from "./types.ts";

// Re-export functions
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

// Main metrics object for backward compatibility
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

/**
 * Main metrics interface
 *
 * Provides methods for recording various metrics and managing metrics state.
 */
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
