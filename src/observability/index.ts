/**
 * OpenTelemetry tracing, metrics collection, auto-instrumentation for
 * fetch/HTTP/React, OTLP export, and structured error and log buffering.
 *
 * @module observability
 */

export {
  addSpanEvent,
  createChildSpan,
  endSpan,
  extractContext,
  getActiveContext,
  getSpanBuffer,
  initTracing,
  injectContext,
  isTracingEnabled,
  resetSpanBuffer,
  setSpanAttributes,
  shutdownTracing,
  SpanBuffer,
  type SpanEntry,
  type SpanFilter,
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
