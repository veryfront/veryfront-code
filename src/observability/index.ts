/**
 * Tracing, metrics, OTLP export, and structured logs.
 *
 * @module observability
 *
 * @example
 * ```ts
 * import { withSpan } from "veryfront/observability";
 *
 * const result = await withSpan("load-data", async () => {
 *   return await fetch("https://example.com/data");
 * });
 * ```
 */

export {
  addSpanEvent,
  createChildSpan,
  endSpan,
  extractContext,
  getActiveContext,
  injectContext,
  isTracingDegraded,
  isTracingEnabled,
  setSpanAttributes,
  SpanNames,
  type SpanOptions,
  startSpan,
  type TracingConfig,
  withActiveSpan,
  withSpan,
  withSpanSync,
} from "./tracing/index.ts";

export {
  getMetricsState,
  isMetricsEnabled,
  type MetricsConfig,
  recordBuild,
  recordBundle,
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  recordCorsRejection,
  recordDataFetch,
  recordDataFetchError,
  recordErrorCount,
  recordHttpRequest,
  recordHttpRequestComplete,
  recordRender,
  recordRenderError,
  recordRSCError,
  recordRSCRender,
  recordRSCRequest,
  recordRSCStream,
  recordSecurityHeaders,
  setCacheSize,
} from "./metrics/index.ts";

export {
  type AutoInstrumentConfig,
  instrument,
  instrumentBatch,
  instrumentErrorHandler,
  instrumentFetch,
  instrumentHttpHandler,
  instrumentReactRender,
  instrumentSync,
  isAutoInstrumentEnabled,
} from "./auto-instrument/index.ts";

export {
  getTraceContext,
  isOTLPEnabled,
  type OTLPConfig,
  setActiveSpanAttributes,
} from "./tracing/otlp-setup.ts";

// OpenTelemetry API shim (spans, metrics, context primitives). `trace` is the
// read-only facade: the process-wide tracer-provider setter stays internal.
export {
  publicTrace as trace,
  SpanKind,
  SpanStatusCode,
} from "./tracing/api-shim.ts";
export type {
  AttributeValue,
  Context,
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  Span,
} from "./tracing/api-shim.ts";

// Shared-runtime telemetry environment helpers
export { isReservedSharedRuntimeTelemetryEnvKey } from "./tracing/telemetry-env.ts";

// Per-request profiling
export { markRequestProfilePhase, profilePhase, profileSyncPhase } from "./request-profiler.ts";
export type { RequestProfileRecord } from "./request-profiler.ts";

// Simple in-process metrics
import { metrics as internalMetrics } from "./simple-metrics/index.ts";
export const metrics = Object.freeze({ ...internalMetrics });
export {
  recordApiRequest,
  recordApiRetry,
  recordContentCacheHit,
  recordContentNetworkFetch,
} from "./simple-metrics/index.ts";
export type { ModuleServeStatus } from "./simple-metrics/index.ts";

export {
  createOpenTelemetryServiceTracer,
  type CreateOpenTelemetryServiceTracerOptions,
  type OpenTelemetryContextApi,
  type OpenTelemetryServiceTracer,
  type OpenTelemetrySpan,
  type OpenTelemetrySpanContext,
  type OpenTelemetryTraceApi,
  type OpenTelemetryTracer,
  type ServiceTracer,
  type ServiceTracerAttributeInput,
  type ServiceTracerAttributes,
  type ServiceTracerAttributeValue,
  type ServiceTracerSpan,
  type ServiceTracerSpanContext,
  type ServiceTracerStartSpanOptions,
} from "./tracing/service-tracer.ts";

export {
  type DevError,
  ErrorCollector,
  type ErrorFilter,
  type ErrorSubscriber,
  type ErrorType,
  parseCompileError,
} from "./error-collector.ts";

export {
  LogBuffer,
  type LogEntry,
  type LogFilter as LogBufferFilter,
  type LogLevel,
  type LogSubscriber,
} from "./log-buffer.ts";

export {
  createFileLogSubscriber,
  type FileLogConfig,
  FileLogSubscriber,
  parseMaxSize,
} from "./file-log-subscriber.ts";

export {
  type ApplicationErrorContext,
  type ApplicationErrorReporter,
  type ApplicationErrorReporterInitializationContext,
  type ApplicationErrorReporterInitializer,
  ApplicationErrorReporterInitializerName,
  type ApplicationErrorReporterLifecycle,
  type ApplicationErrorReporterSession,
  captureApplicationError,
  flushApplicationErrors,
} from "./application-errors.ts";
