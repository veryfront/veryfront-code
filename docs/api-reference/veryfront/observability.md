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
| `SpanKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L119) |
| `SpanNames` | Render span names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L2) |
| `SpanStatusCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L129) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addSpanEvent` | Event emitted for add span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L70) |
| `createChildSpan` | Create child span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L79) |
| `createFileLogSubscriber` | Create file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L194) |
| `createOpenTelemetryServiceTracer` | Create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L200) |
| `endSpan` | End an active tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L57) |
| `extractContext` | Context for extract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L88) |
| `getActiveContext` | Context for get active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L98) |
| `getErrorCollector` | Return error collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L347) |
| `getGlobalMetricsAPI` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L451) |
| `getHostTelemetryEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L7) |
| `getLogBuffer` | Return log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L174) |
| `getMetricsState` | State for get metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L38) |
| `getTraceContext` | Context for get trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L305) |
| `initAutoInstrumentation` | Initialize automatic instrumentation wrappers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L13) |
| `initializeOTLP` | Initialize OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L104) |
| `initMetrics` | Initialize metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L20) |
| `initTracing` | Initialize tracing for the current runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L18) |
| `injectContext` | Context for inject. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L93) |
| `instrument` | Instrument an async operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L6) |
| `instrumentBatch` | Instrument a batch operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L50) |
| `instrumentErrorHandler` | Handler for instrument error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L34) |
| `instrumentFetch` | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L84) |
| `instrumentHttpHandler` | Handler for instrument HTTP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L38) |
| `instrumentReactRender` | Instrument a React render operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L6) |
| `instrumentSync` | Instrument a synchronous operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L28) |
| `interceptConsole` | Capture console output in the log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L186) |
| `isAutoInstrumentEnabled` | Check whether auto instrumentation is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L42) |
| `isMetricsEnabled` | Check whether metrics collection is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L28) |
| `isOTLPEnabled` | Check whether OTLP export is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L122) |
| `isReservedSharedRuntimeTelemetryEnvKey` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L11) |
| `isTracingDegraded` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L30) |
| `isTracingEnabled` | Check whether tracing is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L26) |
| `markRequestProfilePhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L114) |
| `parseCompileError` | Error shape for parse compile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L359) |
| `parseMaxSize` | Parses max size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L28) |
| `profilePhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L101) |
| `profileSyncPhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L121) |
| `recordApiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L291) |
| `recordApiRetry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L305) |
| `recordBuild` | Record build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L124) |
| `recordBundle` | Record bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L132) |
| `recordCacheGet` | Record cache get. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L56) |
| `recordCacheInvalidate` | Record cache invalidate. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L69) |
| `recordCacheSet` | Record cache set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L64) |
| `recordContentCacheHit` | Record a content cache hit at the specified layer | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L329) |
| `recordContentNetworkFetch` | Record a content network fetch with timing | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L355) |
| `recordCorsRejection` | Record CORS rejection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L153) |
| `recordDataFetch` | Record data fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L140) |
| `recordDataFetchError` | Error shape for record data fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L148) |
| `recordErrorCount` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L162) |
| `recordHttpRequest` | Request payload for record HTTP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L43) |
| `recordHttpRequestComplete` | Record HTTP request complete. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L48) |
| `recordRender` | Record render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L82) |
| `recordRenderError` | Error shape for record render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L90) |
| `recordRSCError` | Error shape for record rscerror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L119) |
| `recordRSCRender` | Record RSC render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L95) |
| `recordRSCRequest` | Request payload for record rscrequest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L111) |
| `recordRSCStream` | Record RSC stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L103) |
| `recordSecurityHeaders` | Record security headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L158) |
| `resetErrorCollector` | Reset captured runtime errors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L353) |
| `resetLogBuffer` | Reset the in-memory log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L180) |
| `setActiveSpanAttributes` | Sets active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L282) |
| `setCacheSize` | Sets cache size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L77) |
| `setSpanAttributes` | Sets span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L62) |
| `shutdownMetrics` | Shut down metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L33) |
| `shutdownOTLP` | Shut down OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L116) |
| `shutdownTracing` | Shut down the tracing runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L35) |
| `snapshotRequestProfiles` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L206) |
| `startSpan` | Starts span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L52) |
| `withActiveSpan` | Applies active span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L103) |
| `withSpan` | Applies span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L110) |
| `withSpanSync` | Applies span sync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L129) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ErrorCollector` | Implement error collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L66) |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L53) |
| `LogBuffer` | Implement log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L28) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AttributeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L30) |
| `AutoInstrumentConfig` | Configuration used by auto instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L24) |
| `Context` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L83) |
| `Counter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L145) |
| `CreateOpenTelemetryServiceTracerOptions` | Options accepted by create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L104) |
| `DevError` | Error shape for dev. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L25) |
| `ErrorFilter` | Public API contract for error filter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L51) |
| `ErrorSubscriber` | Public API contract for error subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L63) |
| `ErrorType` | Public API contract for error type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L11) |
| `FileLogConfig` | Configuration used by file log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L4) |
| `Histogram` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L153) |
| `LogBufferFilter` | Filter options for reading buffered log entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L16) |
| `LogEntry` | Entry shape for log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L7) |
| `LogLevel` | Public API contract for log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L4) |
| `LogSubscriber` | Public API contract for log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L25) |
| `Meter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L161) |
| `MetricsConfig` | Configuration used by metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L64) |
| `ModuleServeStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L132) |
| `ObservableGauge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L157) |
| `OpenTelemetryContextApi` | Public API contract for open telemetry context API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L39) |
| `OpenTelemetryServiceTracer` | Public API contract for open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L116) |
| `OpenTelemetrySpan` | Public API contract for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L8) |
| `OpenTelemetrySpanContext` | Context for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L2) |
| `OpenTelemetryTraceApi` | Public API contract for open telemetry trace API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L32) |
| `OpenTelemetryTracer` | Public API contract for open telemetry tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L26) |
| `OTLPConfig` | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L37) |
| `RequestProfileRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L4) |
| `ServiceTracer` | Public API contract for service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L86) |
| `ServiceTracerAttributeInput` | Input payload for service tracer attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L45) |
| `ServiceTracerAttributes` | Public API contract for service tracer attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L54) |
| `ServiceTracerAttributeValue` | Public API contract for service tracer attribute value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L48) |
| `ServiceTracerSpan` | Public API contract for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L63) |
| `ServiceTracerSpanContext` | Context for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L57) |
| `ServiceTracerStartSpanOptions` | Options accepted by service tracer start span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L77) |
| `Span` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L32) |
| `SpanKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L127) |
| `SpanOptions` | Options accepted by span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L14) |
| `SpanStatusCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L135) |
| `TracingConfig` | Configuration used by tracing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L4) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `metrics` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/index.ts#L76) |
| `trace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L365) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/observability/otlp-setup`

*********************** OpenTelemetry OTLP Setup Thin wrapper that delegates to the `ext-observability-opentelemetry` extension via the `TracingExporter` contract. When the extension is not installed, all span operations silently no-op. Reads configuration from environment variables: - OTEL_TRACES_ENABLED: "true" to enable tracing - OTEL_SERVICE_NAME: Service name for traces - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint - OTEL_EXPORTER_OTLP_HEADERS: Auth headers ************************

```ts
import { addSpanEvent, endServerSpan, extractContext } from "veryfront/observability/otlp-setup";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addSpanEvent` | Adds an event to a span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L270) |
| `endServerSpan` | End an active server tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L236) |
| `extractContext` | Context for extract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L205) |
| `getTraceContext` | Context for get trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L305) |
| `initializeOTLP` | Initialize OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L104) |
| `initializeOTLPWithApis` | Initialize OTLP tracing with explicit API adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L127) |
| `injectContext` | Context for inject. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L213) |
| `isOTLPEnabled` | Check whether OTLP export is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L122) |
| `setActiveSpanAttributes` | Sets active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L282) |
| `setActiveSpanErrorStatus` | Marks the active span as failed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L292) |
| `setSpanAttributes` | Sets span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L259) |
| `shutdownOTLP` | Shut down OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L116) |
| `startServerSpan` | Starts server span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L220) |
| `withContext` | Context for with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L300) |
| `withSpan` | Applies span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L148) |
| `withSpanSync` | Applies span sync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L177) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `OTLPConfig` | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L37) |
| `WithSpanOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L143) |
