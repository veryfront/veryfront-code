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

/** Closed, bounded label values for required model-call context writer outcomes. */
export const MODEL_CALL_CONTEXT_WRITER_OUTCOMES = Object.freeze(
  [
    "recorded",
    "disabled",
    "append_failed",
    "retry_scheduled",
    "stopped",
    "ambiguous_durable_replay",
    "pending_after_flush",
    "successor_in_flight",
    "partial_append_failed",
  ] as const,
);

export type ModelCallContextWriterOutcome = (typeof MODEL_CALL_CONTEXT_WRITER_OUTCOMES)[number];

/** Closed, bounded label values for required model-call context barrier outcomes. */
export const MODEL_CALL_CONTEXT_BARRIER_OUTCOMES = Object.freeze(
  [
    "timeout",
    "aborted",
  ] as const,
);

export type ModelCallContextBarrierOutcome = (typeof MODEL_CALL_CONTEXT_BARRIER_OUTCOMES)[number];

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
  dependencyArtifactBuildCounter: Counter | null;
  dependencyArtifactBuildDuration: Histogram | null;
  dependencyArtifactBuildBytes: Histogram | null;
  dependencyArtifactBuildAssetCount: Histogram | null;
  dependencyArtifactBuildExternalImportCount: Histogram | null;

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

  streamLifecycleOutcomeCounter: Counter | null;
  streamLifecycleDeadlineCounter: Counter | null;
  streamLifecycleTelemetryCounter: Counter | null;
  streamLifecycleRepairCounter: Counter | null;
  streamLifecycleShadowDivergenceCounter: Counter | null;
  streamLifecycleAttemptDuration: Histogram | null;
  streamLifecycleFirstProgressDuration: Histogram | null;
  streamLifecycleSemanticIdleDuration: Histogram | null;
  streamLifecycleToolInputDuration: Histogram | null;
  streamLifecycleToolExecutionDuration: Histogram | null;

  modelCallContextWriterOutcomeCounter: Counter | null;
  modelCallContextBarrierOutcomeCounter: Counter | null;
  modelCallContextLogicalByteLength: Histogram | null;
  modelCallContextPartCount: Histogram | null;
  modelCallContextAppendRequestCount: Histogram | null;
  modelCallContextRecorderBarrierDuration: Histogram | null;
}

/** Configuration used by metrics. */
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
