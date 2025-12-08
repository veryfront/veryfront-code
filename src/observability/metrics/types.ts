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
} from "@opentelemetry/api";

/**
 * OpenTelemetry API module type
 */
export interface OpenTelemetryAPI {
  metrics: {
    getMeter(name: string | undefined, version?: string): Meter;
  };
}

/**
 * Metrics instruments collection
 */
export interface MetricsInstruments {
  // HTTP metrics
  httpRequestCounter: Counter | null;
  httpRequestDuration: Histogram | null;
  httpActiveRequests: UpDownCounter | null;

  // Cache metrics
  cacheGetCounter: Counter | null;
  cacheHitCounter: Counter | null;
  cacheMissCounter: Counter | null;
  cacheSetCounter: Counter | null;
  cacheInvalidateCounter: Counter | null;
  cacheSizeGauge: ObservableGauge | null;

  // Render metrics
  renderDuration: Histogram | null;
  renderCounter: Counter | null;
  renderErrorCounter: Counter | null;

  // RSC metrics
  rscRenderDuration: Histogram | null;
  rscStreamDuration: Histogram | null;
  rscManifestCounter: Counter | null;
  rscPageCounter: Counter | null;
  rscStreamCounter: Counter | null;
  rscActionCounter: Counter | null;
  rscErrorCounter: Counter | null;

  // Build metrics
  buildDuration: Histogram | null;
  bundleSizeHistogram: Histogram | null;
  bundleCounter: Counter | null;

  // Data fetching metrics
  dataFetchDuration: Histogram | null;
  dataFetchCounter: Counter | null;
  dataFetchErrorCounter: Counter | null;

  // Security metrics
  corsRejectionCounter: Counter | null;
  securityHeadersCounter: Counter | null;

  // Memory metrics
  memoryUsageGauge: ObservableGauge | null;
  heapUsageGauge: ObservableGauge | null;
}

/**
 * Metrics configuration options
 */
export interface MetricsConfig {
  enabled: boolean;
  exporter: "prometheus" | "otlp" | "console";
  endpoint?: string;
  prefix?: string;
  collectInterval?: number;
  debug?: boolean;
}

/**
 * Runtime state for observable metrics
 */
export interface RuntimeState {
  cacheSize: number;
  activeRequests: number;
}

/**
 * Memory usage information
 */
export interface MemoryUsage {
  rss: number;
  heapUsed: number;
  heapTotal: number;
}
