/**
 * Metrics Types
 * Type definitions for OpenTelemetry metrics system
 */

import type { Counter, Histogram, Meter, ObservableGauge, UpDownCounter } from "@opentelemetry/api";

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
  errorRate: Histogram | null;
}

export interface MetricsConfig {
  enabled: boolean;
  exporter: "prometheus" | "otlp" | "console";
  endpoint?: string;
  prefix?: string;
  collectInterval?: number;
  debug?: boolean;
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
