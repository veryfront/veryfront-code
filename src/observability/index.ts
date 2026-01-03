/**
 * Veryfront Observability
 *
 * Comprehensive OpenTelemetry integration for distributed tracing and metrics
 */

// Export tracing utilities
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

// Export metrics utilities
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

// Export OTLP setup for Grafana Cloud
export {
  initializeOTLP,
  isOTLPEnabled,
  type OTLPConfig,
  shutdownOTLP,
} from "./tracing/otlp-setup.ts";
