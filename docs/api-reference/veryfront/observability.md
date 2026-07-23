---
title: "veryfront/observability"
description: "Tracing, metrics, OTLP export, and structured logs."
order: 20
---

## Import

```ts
import {
  addSpanEvent,
  createChildSpan,
  createFileLogSubscriber,
  createOpenTelemetryServiceTracer,
  endSpan,
  extractContext,
} from "veryfront/observability";
```

## Examples

```ts
import { withSpan } from "veryfront/observability";

const result = await withSpan("load-data", async () => {
  return await fetch("https://example.com/data");
});
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `SpanKind` | Numeric OpenTelemetry span-kind constants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L163) |
| `SpanNames` | Render span names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L2) |
| `SpanStatusCode` | Numeric OpenTelemetry span-status constants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L175) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addSpanEvent` | Add a bounded event to a span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L71) |
| `createChildSpan` | Create a child span under an optional parent span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L80) |
| `createFileLogSubscriber` | Create file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L374) |
| `createOpenTelemetryServiceTracer` | Create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L312) |
| `endSpan` | End an active tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L58) |
| `extractContext` | Extract trace context from request headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L89) |
| `getActiveContext` | Return the active trace context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L99) |
| `getErrorCollector` | Return error collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L426) |
| `getGlobalMetricsAPI` | Return the metrics API registered by the observability extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L512) |
| `getHostTelemetryEnv` | Read a telemetry value from the process-owned host environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L8) |
| `getLogBuffer` | Return log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L288) |
| `getMetricsState` | Return a metrics runtime state snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L39) |
| `getTraceContext` | Return validated identifiers for the active trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L519) |
| `initAutoInstrumentation` | Initialize automatic instrumentation wrappers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L27) |
| `initializeOTLP` | Mark the legacy OTLP lifecycle as initialized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L153) |
| `initMetrics` | Initialize metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L21) |
| `initTracing` | Initialize tracing for the current runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L18) |
| `injectContext` | Inject trace context into request headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L94) |
| `instrument` | Instrument an async operation with bounded automatic telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L8) |
| `instrumentBatch` | Instrument a batch operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L52) |
| `instrumentErrorHandler` | Instrument an error handler with bounded failure metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L73) |
| `instrumentFetch` | Create a fetch implementation instrumented with low-cardinality spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L120) |
| `instrumentHttpHandler` | Instrument an HTTP handler without recording concrete request identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L61) |
| `instrumentReactRender` | Instrument a React render operation without recording component identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L28) |
| `instrumentSync` | Instrument a synchronous operation with bounded automatic telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L30) |
| `interceptConsole` | Capture console output in the log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L300) |
| `isAutoInstrumentEnabled` | Check whether auto instrumentation is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L69) |
| `isMetricsEnabled` | Check whether metrics collection is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L29) |
| `isOTLPEnabled` | Check whether the legacy OTLP lifecycle is initialized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L173) |
| `isReservedSharedRuntimeTelemetryEnvKey` | Check whether a host-owned telemetry key must be hidden from project overlays. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L13) |
| `isTracingDegraded` | Check whether tracing initialized in degraded mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L31) |
| `isTracingEnabled` | Check whether tracing is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L26) |
| `markRequestProfilePhase` | Add or accumulate a bounded phase duration on the active request profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L196) |
| `parseCompileError` | Error shape for parse compile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L438) |
| `parseMaxSize` | Parse and validate a file rotation size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L44) |
| `profilePhase` | Measure an asynchronous phase on the active request profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L182) |
| `profileSyncPhase` | Measure a synchronous phase on the active request profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L204) |
| `recordApiRequest` | Record one API response by normalized status class. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L323) |
| `recordApiRetry` | Record one API retry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L339) |
| `recordBuild` | Record a build duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L125) |
| `recordBundle` | Record a bundle size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L133) |
| `recordCacheGet` | Record a cache lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L57) |
| `recordCacheInvalidate` | Record cache invalidation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L70) |
| `recordCacheSet` | Record a cache write. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L65) |
| `recordContentCacheHit` | Record a content cache hit at the specified layer | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L358) |
| `recordContentNetworkFetch` | Record a content network fetch with timing | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L384) |
| `recordCorsRejection` | Record a CORS rejection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L154) |
| `recordDataFetch` | Record a data fetch duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L141) |
| `recordDataFetchError` | Record a data fetch failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L149) |
| `recordErrorCount` | Record a categorized error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L164) |
| `recordHttpRequest` | Record the start of an HTTP request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L44) |
| `recordHttpRequestComplete` | Record completion of an HTTP request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L49) |
| `recordRender` | Record a completed render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L83) |
| `recordRenderError` | Record a render failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L91) |
| `recordRSCError` | Record an RSC failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L120) |
| `recordRSCRender` | Record an RSC render duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L96) |
| `recordRSCRequest` | Record an RSC request by kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L112) |
| `recordRSCStream` | Record an RSC stream duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L104) |
| `recordSecurityHeaders` | Record security-header application. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L159) |
| `resetErrorCollector` | Reset captured runtime errors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L432) |
| `resetLogBuffer` | Reset the in-memory log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L294) |
| `setActiveSpanAttributes` | Set bounded attributes on the active span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L464) |
| `setCacheSize` | Set the current cache size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L78) |
| `setSpanAttributes` | Set bounded attributes on a span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L63) |
| `shutdownMetrics` | Shut down metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L34) |
| `shutdownOTLP` | Reset the legacy OTLP lifecycle and cached tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L165) |
| `shutdownTracing` | Shut down the tracing runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L36) |
| `snapshotRequestProfiles` | Return a deep snapshot of recent request profiles. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L308) |
| `startSpan` | Start a bounded manual span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L53) |
| `withActiveSpan` | Run an asynchronous callback with a span active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L104) |
| `withSpan` | Run an asynchronous callback in a new span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L111) |
| `withSpanSync` | Run a synchronous callback in a new span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L130) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ErrorCollector` | Collect bounded, sanitized development errors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L72) |
| `FileLogSubscriber` | Persist buffered log entries with bounded asynchronous rotation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L132) |
| `LogBuffer` | Store bounded, sanitized in-process log snapshots. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L44) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AttributePrimitive` | Scalar value accepted by OpenTelemetry attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L32) |
| `AttributeValue` | Value accepted by OpenTelemetry attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L35) |
| `AutoInstrumentationMetricsConfig` | Metrics settings accepted by automatic instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L23) |
| `AutoInstrumentationTracingConfig` | Tracing settings accepted by automatic instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L11) |
| `AutoInstrumentConfig` | Configuration used by auto instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L35) |
| `BatchOptions` | Options accepted by batched automatic operation wrappers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L64) |
| `ContentCacheLayer` | Cache layer that served a content lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L344) |
| `Context` | Immutable key-value context propagated across asynchronous work. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L107) |
| `Counter` | Monotonic counter instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L195) |
| `CreateOpenTelemetryServiceTracerOptions` | Options accepted by create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L122) |
| `DevError` | Error shape for dev. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L29) |
| `ErrorCategory` | Error categories for domain-based grouping and handling | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L7) |
| `ErrorFilter` | Public API contract for error filter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L55) |
| `ErrorSubscriber` | Public API contract for error subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L69) |
| `ErrorType` | Public API contract for error type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L15) |
| `FileLogConfig` | Configuration used by file log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L9) |
| `Histogram` | Histogram instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L207) |
| `HttpHandlerInstrumentationOptions` | Options for automatic HTTP handler instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L5) |
| `InstrumentOptions` | Options accepted by automatic operation wrappers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L51) |
| `LogBufferFilter` | Filter options for reading buffered log entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L27) |
| `LogEntry` | Entry shape for log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L12) |
| `LogLevel` | Public API contract for log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L9) |
| `LogSubscriber` | Public API contract for log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L41) |
| `Meter` | Factory for metric instruments in one instrumentation scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L219) |
| `MetricsAPI` | Registry that creates named metric meters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L246) |
| `MetricsConfig` | Configuration used by metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L64) |
| `MetricsRuntimeState` | Immutable snapshot of the metrics manager's runtime state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L80) |
| `ModuleServeStatus` | Outcome recorded for a module serve operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L153) |
| `ObservabilityRuntimeAdapter` | Minimal runtime surface used by observability configuration loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/runtime-adapter.ts#L8) |
| `ObservableGauge` | Observable gauge instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L213) |
| `ObservableResult` | Callback result used to report observable measurements. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L189) |
| `OpenTelemetryContextApi` | Public API contract for open telemetry context API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L56) |
| `OpenTelemetryServiceTracer` | Public API contract for open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L134) |
| `OpenTelemetrySpan` | Public API contract for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L25) |
| `OpenTelemetrySpanContext` | Context for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L19) |
| `OpenTelemetryTraceApi` | Public API contract for open telemetry trace API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L49) |
| `OpenTelemetryTracer` | Public API contract for open telemetry tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L43) |
| `OTLPConfig` | Host-owned OTLP configuration snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L46) |
| `RequestProfileRecord` | Bounded timing record for one completed request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L6) |
| `ServiceTracer` | Public API contract for service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L104) |
| `ServiceTracerAttributeInput` | Input payload for service tracer attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L62) |
| `ServiceTracerAttributePrimitive` | Scalar value accepted by the service tracer's OpenTelemetry bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L64) |
| `ServiceTracerAttributes` | Public API contract for service tracer attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L72) |
| `ServiceTracerAttributeValue` | Public API contract for service tracer attribute value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L66) |
| `ServiceTracerSpan` | Public API contract for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L81) |
| `ServiceTracerSpanContext` | Context for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L75) |
| `ServiceTracerStartSpanOptions` | Options accepted by service tracer start span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L95) |
| `Span` | Minimal span contract used by the Veryfront runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L38) |
| `SpanContext` | Propagation identifiers associated with a span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L58) |
| `SpanKind` | OpenTelemetry span-kind value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L172) |
| `SpanOptions` | Options accepted by span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L20) |
| `SpanStatusCode` | OpenTelemetry span-status value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L182) |
| `TracingConfig` | Configuration used by tracing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L4) |
| `UpDownCounter` | Counter instrument that accepts positive and negative changes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L201) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `metrics` | Stable facade for the in-process metrics recording functions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/index.ts#L77) |
| `trace` | Minimal global trace API backed by the registered provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L418) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/observability/otlp-setup`

Legacy OTLP helpers backed by the global OpenTelemetry extension. Span callbacks still run when the extension is absent, but span operations become no-ops. Exporter configuration comes from the host telemetry environment.

```ts
import { addSpanEvent, endServerSpan, extractContext } from "veryfront/observability/otlp-setup";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addSpanEvent` | Add a bounded, sanitized event to a span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L447) |
| `endServerSpan` | End an active server tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L402) |
| `extractContext` | Extract W3C trace context from bounded propagation headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L327) |
| `getTraceContext` | Return validated identifiers for the active trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L519) |
| `initializeOTLP` | Mark the legacy OTLP lifecycle as initialized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L153) |
| `initializeOTLPWithApis` | Initialize the legacy OTLP lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L178) |
| `injectContext` | Inject W3C trace context into response headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L348) |
| `isOTLPEnabled` | Check whether the legacy OTLP lifecycle is initialized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L173) |
| `setActiveSpanAttributes` | Set bounded attributes on the active span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L464) |
| `setActiveSpanErrorStatus` | Marks the active span as failed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L480) |
| `setSpanAttributes` | Set bounded, sanitized span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L434) |
| `shutdownOTLP` | Reset the legacy OTLP lifecycle and cached tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L165) |
| `startServerSpan` | Start a server span without recording a concrete request path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L373) |
| `withContext` | Run a callback once inside the supplied context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L491) |
| `withSpan` | Run an asynchronous callback in a bounded span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L217) |
| `withSpanSync` | Run a synchronous callback in a bounded span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L273) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `OTLPConfig` | Host-owned OTLP configuration snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L46) |
| `StartServerSpanOptions` | Options for generic server span creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L367) |
| `WithSpanOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L212) |
