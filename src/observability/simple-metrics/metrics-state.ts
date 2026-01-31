import type { MetricsState, VeryfrontMetrics } from "./types.ts";

const SSR_BOUNDARIES_MS = [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

export const state: MetricsState = {
  requests: 0,
  jitHttpResolved: 0,
  jitHttpBlocked: 0,
  jitHttpFetchMsTotal: 0,
  rscManifest: 0,
  rscPage: 0,
  rscStream: 0,
  rscAction: 0,
  rscErrors: 0,
  cacheGets: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheSets: 0,
  cacheInvalidations: 0,
  ssrHistogram: undefined,
  rscStreamHistogram: undefined,
  corsRejections: 0,
  securityHeadersApplied: 0,
  apiRequests2xx: 0,
  apiRequests4xx: 0,
  apiRequests5xx: 0,
  apiRetries: 0,
  _ssrCounts: Array.from({ length: SSR_BOUNDARIES_MS.length + 1 }, () => 0),
};

export function getSSRBoundaries(): number[] {
  return SSR_BOUNDARIES_MS;
}

export function createSnapshot(): VeryfrontMetrics {
  return {
    requests: state.requests,
    jitHttpResolved: state.jitHttpResolved,
    jitHttpBlocked: state.jitHttpBlocked,
    jitHttpFetchMsTotal: state.jitHttpFetchMsTotal,
    rscManifest: state.rscManifest,
    rscPage: state.rscPage,
    rscStream: state.rscStream,
    rscAction: state.rscAction,
    rscErrors: state.rscErrors,
    cacheGets: state.cacheGets,
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    cacheSets: state.cacheSets,
    cacheInvalidations: state.cacheInvalidations,
    corsRejections: state.corsRejections,
    securityHeadersApplied: state.securityHeadersApplied,
    apiRequests2xx: state.apiRequests2xx,
    apiRequests4xx: state.apiRequests4xx,
    apiRequests5xx: state.apiRequests5xx,
    apiRetries: state.apiRetries,
    ssrHistogram: {
      boundaries: [...SSR_BOUNDARIES_MS],
      counts: [...state._ssrCounts],
    },
    rscStreamHistogram: state.rscStreamHistogram
      ? {
        boundaries: [...state.rscStreamHistogram.boundaries],
        counts: [...state.rscStreamHistogram.counts],
      }
      : undefined,
  };
}

export function resetMetrics(): void {
  state.requests = 0;
  state.jitHttpResolved = 0;
  state.jitHttpBlocked = 0;
  state.jitHttpFetchMsTotal = 0;
  state.rscManifest = 0;
  state.rscPage = 0;
  state.rscStream = 0;
  state.rscAction = 0;
  state.rscErrors = 0;
  state.cacheGets = 0;
  state.cacheHits = 0;
  state.cacheMisses = 0;
  state.cacheSets = 0;
  state.cacheInvalidations = 0;
  state.corsRejections = 0;
  state.securityHeadersApplied = 0;
  state.apiRequests2xx = 0;
  state.apiRequests4xx = 0;
  state.apiRequests5xx = 0;
  state.apiRetries = 0;
  state._ssrCounts.fill(0);
  state.rscStreamHistogram = undefined;
}

export function getRequestCount(): number {
  return state.requests;
}
