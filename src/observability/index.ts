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
  initTracing,
  injectContext,
  isTracingEnabled,
  setSpanAttributes,
  shutdownTracing,
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
  initMetrics,
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
  shutdownMetrics,
} from "./metrics/index.ts";

export {
  type AutoInstrumentConfig,
  initAutoInstrumentation,
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
  initializeOTLP,
  isOTLPEnabled,
  type OTLPConfig,
  shutdownOTLP,
} from "./tracing/otlp-setup.ts";

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
  getErrorCollector,
  parseCompileError,
  resetErrorCollector,
} from "./error-collector.ts";

export {
  getLogBuffer,
  interceptConsole,
  LogBuffer,
  type LogEntry,
  type LogFilter as LogBufferFilter,
  type LogLevel,
  type LogSubscriber,
  resetLogBuffer,
} from "./log-buffer.ts";

export {
  createFileLogSubscriber,
  type FileLogConfig,
  FileLogSubscriber,
  parseMaxSize,
} from "./file-log-subscriber.ts";
