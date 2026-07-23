/**
 * Metrics Types
 * Type definitions for OpenTelemetry metrics system
 */

import type {
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  UpDownCounter,
} from "#veryfront/observability/tracing/api-shim.ts";

export interface OpenTelemetryAPI {
  metrics: {
    getMeter(name: string | undefined, version?: string): Meter;
  };
}

export interface MetricsInstruments {
  httpRequestCounter: Counter | null;
  httpRequestDuration: Histogram | null;
  httpActiveRequests: UpDownCounter | null;

  cacheGetCounter: Counter | null;
  cacheHitCounter: Counter | null;
  cacheMissCounter: Counter | null;
  cacheSetCounter: Counter | null;
  cacheInvalidateCounter: Counter | null;
  cacheSizeGauge: ObservableGauge | null;

  renderDuration: Histogram | null;
  renderCounter: Counter | null;
  renderErrorCounter: Counter | null;

  rscRenderDuration: Histogram | null;
  rscStreamDuration: Histogram | null;
  rscManifestCounter: Counter | null;
  rscPageCounter: Counter | null;
  rscStreamCounter: Counter | null;
  rscActionCounter: Counter | null;
  rscErrorCounter: Counter | null;

  buildDuration: Histogram | null;
  bundleSizeHistogram: Histogram | null;
  bundleCounter: Counter | null;

  dataFetchDuration: Histogram | null;
  dataFetchCounter: Counter | null;
  dataFetchErrorCounter: Counter | null;

  corsRejectionCounter: Counter | null;
  securityHeadersCounter: Counter | null;

  memoryUsageGauge: ObservableGauge | null;
  heapUsageGauge: ObservableGauge | null;
  heapTotalGauge: ObservableGauge | null;
  heapPercentGauge: ObservableGauge | null;

  errorCounter: Counter | null;
}

/** Configuration used by metrics. */
export interface MetricsConfig {
  /** Whether metrics collection is enabled. */
  enabled: boolean;
  /** Metrics exporter selected for this runtime. */
  exporter: "prometheus" | "otlp" | "console";
  /** Optional exporter endpoint. */
  endpoint?: string;
  /** Prefix applied to metric instrument names. */
  prefix?: string;
  /** Collection interval in milliseconds. */
  collectInterval?: number;
  /** Whether diagnostic telemetry logging is enabled. */
  debug?: boolean;
}

/** Immutable snapshot of the metrics manager's runtime state. */
export interface MetricsRuntimeState {
  /** Whether the manager has completed initialization. */
  initialized: boolean;
  /** Most recently recorded cache size. */
  cacheSize: number;
  /** Number of requests currently being tracked. */
  activeRequests: number;
}

export interface RuntimeState {
  cacheSize: number;
  activeRequests: number;
}

export interface MemoryUsage {
  rss: number;
  heapUsed: number;
  heapTotal: number;
}
