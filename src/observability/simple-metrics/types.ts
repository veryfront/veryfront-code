/**
 * Metrics type definitions for Veryfront
 * @module
 */

import type { Counter, Histogram, Meter } from "@opentelemetry/api";

/**
 * Observability metrics interface for lazy-loaded metrics recording
 */
export interface ObservabilityMetrics {
  /** Record render duration */
  recordRender: (durationMs: number) => void;
  /** Record cache get operation */
  recordCacheGet: (hit: boolean) => void;
  /** Record cache set operation */
  recordCacheSet: () => void;
  /** Record cache invalidation */
  recordCacheInvalidate: (count: number) => void;
  /** Record HTTP request */
  recordHttpRequest: () => void;
  /** Record RSC request */
  recordRSCRequest: (
    type: "manifest" | "page" | "stream" | "action",
    attributes?: Record<string, string>,
  ) => void;
  /** Record RSC stream duration */
  recordRSCStream: (durationMs: number) => void;
}

/**
 * Veryfront metrics snapshot interface
 */
export interface VeryfrontMetrics {
  /** Total requests handled */
  requests: number;
  /** JIT HTTP requests resolved */
  jitHttpResolved: number;
  /** JIT HTTP requests blocked */
  jitHttpBlocked: number;
  /** Total JIT HTTP fetch time in ms */
  jitHttpFetchMsTotal: number;
  /** RSC manifest requests */
  rscManifest: number;
  /** RSC page requests */
  rscPage: number;
  /** RSC stream requests */
  rscStream: number;
  /** RSC action requests */
  rscAction: number;
  /** RSC errors */
  rscErrors: number;
  /** RSC stream duration histogram */
  rscStreamHistogram?: { boundaries: number[]; counts: number[] };
  /** Cache get operations */
  cacheGets: number;
  /** Cache hits */
  cacheHits: number;
  /** Cache misses */
  cacheMisses: number;
  /** Cache set operations */
  cacheSets: number;
  /** Cache invalidations */
  cacheInvalidations: number;
  /** SSR render duration histogram */
  ssrHistogram?: { boundaries: number[]; counts: number[] };
  /** Security: CORS rejections */
  corsRejections: number;
  /** Security: Responses with security headers applied */
  securityHeadersApplied: number;
  /** API requests by status code category */
  apiRequests2xx: number;
  apiRequests4xx: number;
  apiRequests5xx: number;
  /** API request retries */
  apiRetries: number;
}

/**
 * Internal metrics state with histogram counts
 */
export interface MetricsState extends VeryfrontMetrics {
  /** Internal SSR histogram counts */
  _ssrCounts: number[];
}

/**
 * OpenTelemetry instruments collection
 */
export interface OtelInstruments {
  /** OpenTelemetry meter */
  meter?: Meter;
  /** SSR duration histogram */
  ssrHistogram?: Histogram;
  /** Request counter */
  requestCounter?: Counter;
  /** JIT resolved counter */
  jitResolvedCounter?: Counter;
  /** JIT blocked counter */
  jitBlockedCounter?: Counter;
  /** Cache get counter */
  cacheGetCounter?: Counter;
  /** Cache hit counter */
  cacheHitCounter?: Counter;
  /** Cache miss counter */
  cacheMissCounter?: Counter;
  /** Cache set counter */
  cacheSetCounter?: Counter;
  /** Cache invalidate counter */
  cacheInvalidateCounter?: Counter;
}

/**
 * RSC request types
 */
export type RSCRequestKind = "manifest" | "page" | "stream" | "action" | "error" | "flight_page";
