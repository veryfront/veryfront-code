/**************************************************
 * Metrics type definitions for Veryfront
 * @module
 **************************************************/

import type { Counter, Histogram, Meter } from "@opentelemetry/api";

export type RSCRequestKind =
  | "manifest"
  | "page"
  | "stream"
  | "action"
  | "error"
  | "flight_page";

export interface ObservabilityMetrics {
  recordRender: (durationMs: number) => void;
  recordCacheGet: (hit: boolean) => void;
  recordCacheSet: () => void;
  recordCacheInvalidate: (count: number) => void;
  recordHttpRequest: () => void;
  recordRSCRequest: (
    type: Exclude<RSCRequestKind, "error" | "flight_page">,
    attributes?: Record<string, string>,
  ) => void;
  recordRSCStream: (durationMs: number) => void;
}

export interface VeryfrontMetrics {
  requests: number;
  jitHttpResolved: number;
  jitHttpBlocked: number;
  jitHttpFetchMsTotal: number;
  rscManifest: number;
  rscPage: number;
  rscStream: number;
  rscAction: number;
  rscErrors: number;
  rscStreamHistogram?: { boundaries: number[]; counts: number[] };
  cacheGets: number;
  cacheHits: number;
  cacheMisses: number;
  cacheSets: number;
  cacheInvalidations: number;
  ssrHistogram?: { boundaries: number[]; counts: number[] };
  corsRejections: number;
  securityHeadersApplied: number;
  apiRequests2xx: number;
  apiRequests4xx: number;
  apiRequests5xx: number;
  apiRetries: number;
}

export interface MetricsState extends VeryfrontMetrics {
  _ssrCounts: number[];
}

export interface OtelInstruments {
  meter?: Meter;
  ssrHistogram?: Histogram;
  requestCounter?: Counter;
  jitResolvedCounter?: Counter;
  jitBlockedCounter?: Counter;
  cacheGetCounter?: Counter;
  cacheHitCounter?: Counter;
  cacheMissCounter?: Counter;
  cacheSetCounter?: Counter;
  cacheInvalidateCounter?: Counter;
}
