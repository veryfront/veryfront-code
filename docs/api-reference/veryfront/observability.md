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
| `SpanKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L121) |
| `SpanNames` | Render span names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L2) |
| `SpanStatusCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L131) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addSpanEvent` | Event emitted for add span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L70) |
| `createChildSpan` | Create child span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L79) |
| `createFileLogSubscriber` | Create file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L380) |
| `createOpenTelemetryServiceTracer` | Create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L357) |
| `endSpan` | End an active tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L57) |
| `extractContext` | Context for extract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L88) |
| `getActiveContext` | Context for get active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L98) |
| `getErrorCollector` | Return error collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L390) |
| `getGlobalMetricsAPI` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L669) |
| `getHostTelemetryEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L7) |
| `getLogBuffer` | Return log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L220) |
| `getMetricsState` | State for get metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L38) |
| `getTraceContext` | Context for get trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L494) |
| `initAutoInstrumentation` | Initialize automatic instrumentation wrappers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L13) |
| `initializeOTLP` | Initialize OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L111) |
| `initMetrics` | Initialize metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L20) |
| `initTracing` | Initialize tracing for the current runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L18) |
| `injectContext` | Context for inject. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L93) |
| `instrument` | Instrument an async operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L6) |
| `instrumentBatch` | Instrument a batch operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L50) |
| `instrumentErrorHandler` | Handler for instrument error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L35) |
| `instrumentFetch` | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L127) |
| `instrumentHttpHandler` | Handler for instrument HTTP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L85) |
| `instrumentReactRender` | Instrument a React render operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L8) |
| `instrumentSync` | Instrument a synchronous operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L28) |
| `interceptConsole` | Capture console output in the log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L232) |
| `isAutoInstrumentEnabled` | Check whether auto instrumentation is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L42) |
| `isMetricsEnabled` | Check whether metrics collection is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L28) |
| `isOTLPEnabled` | Check whether OTLP export is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L129) |
| `isReservedSharedRuntimeTelemetryEnvKey` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L11) |
| `isTracingDegraded` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L30) |
| `isTracingEnabled` | Check whether tracing is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L26) |
| `markRequestProfilePhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L141) |
| `parseCompileError` | Error shape for parse compile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L402) |
| `parseMaxSize` | Parses max size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L31) |
| `profilePhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L128) |
| `profileSyncPhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L148) |
| `recordApiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L307) |
| `recordApiRetry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L322) |
| `recordBuild` | Record build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L124) |
| `recordBundle` | Record bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L132) |
| `recordCacheGet` | Record cache get. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L56) |
| `recordCacheInvalidate` | Record cache invalidate. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L69) |
| `recordCacheSet` | Record cache set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L64) |
| `recordContentCacheHit` | Record a content cache hit at the specified layer | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L344) |
| `recordContentNetworkFetch` | Record a content network fetch with timing | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L370) |
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
| `resetErrorCollector` | Reset captured runtime errors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L396) |
| `resetLogBuffer` | Reset the in-memory log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L226) |
| `setActiveSpanAttributes` | Sets active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L462) |
| `setCacheSize` | Sets cache size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L77) |
| `setSpanAttributes` | Sets span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L62) |
| `shutdownMetrics` | Shut down metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L33) |
| `shutdownOTLP` | Shut down OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L123) |
| `shutdownTracing` | Shut down the tracing runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L35) |
| `snapshotRequestProfiles` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L245) |
| `startSpan` | Starts span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L52) |
| `withActiveSpan` | Applies active span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L103) |
| `withSpan` | Applies span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L110) |
| `withSpanSync` | Applies span sync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L129) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ErrorCollector` | Implement error collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L90) |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L122) |
| `LogBuffer` | Implement log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L37) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AttributeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L32) |
| `AutoInstrumentConfig` | Configuration used by auto instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L24) |
| `Context` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L85) |
| `Counter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L147) |
| `CreateOpenTelemetryServiceTracerOptions` | Options accepted by create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L108) |
| `DevError` | Error shape for dev. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L32) |
| `ErrorFilter` | Public API contract for error filter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L58) |
| `ErrorSubscriber` | Public API contract for error subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L70) |
| `ErrorType` | Public API contract for error type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L14) |
| `FileLogConfig` | Configuration used by file log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L7) |
| `Histogram` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L155) |
| `LogBufferFilter` | Filter options for reading buffered log entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L18) |
| `LogEntry` | Entry shape for log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L9) |
| `LogLevel` | Public API contract for log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L6) |
| `LogSubscriber` | Public API contract for log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L27) |
| `Meter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L164) |
| `MetricsConfig` | Configuration used by metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L64) |
| `ModuleServeStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L144) |
| `ObservableGauge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L159) |
| `OpenTelemetryContextApi` | Public API contract for open telemetry context API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L43) |
| `OpenTelemetryServiceTracer` | Public API contract for open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L120) |
| `OpenTelemetrySpan` | Public API contract for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L12) |
| `OpenTelemetrySpanContext` | Context for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L6) |
| `OpenTelemetryTraceApi` | Public API contract for open telemetry trace API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L36) |
| `OpenTelemetryTracer` | Public API contract for open telemetry tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L30) |
| `OTLPConfig` | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L44) |
| `RequestProfileRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L9) |
| `ServiceTracer` | Public API contract for service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L90) |
| `ServiceTracerAttributeInput` | Input payload for service tracer attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L49) |
| `ServiceTracerAttributes` | Public API contract for service tracer attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L58) |
| `ServiceTracerAttributeValue` | Public API contract for service tracer attribute value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L52) |
| `ServiceTracerSpan` | Public API contract for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L67) |
| `ServiceTracerSpanContext` | Context for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L61) |
| `ServiceTracerStartSpanOptions` | Options accepted by service tracer start span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L81) |
| `Span` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L34) |
| `SpanKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L129) |
| `SpanOptions` | Options accepted by span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L14) |
| `SpanStatusCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L137) |
| `TracingConfig` | Configuration used by tracing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L4) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `metrics` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/index.ts#L76) |
| `trace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L573) |

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
| `addSpanEvent` | Adds an event to a span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L447) |
| `endServerSpan` | End an active server tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L399) |
| `extractContext` | Context for extract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L330) |
| `getTraceContext` | Context for get trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L494) |
| `initializeOTLP` | Initialize OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L111) |
| `initializeOTLPWithApis` | Initialize OTLP tracing with explicit API adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L134) |
| `injectContext` | Context for inject. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L342) |
| `isOTLPEnabled` | Check whether OTLP export is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L129) |
| `setActiveSpanAttributes` | Sets active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L462) |
| `setActiveSpanErrorStatus` | Marks the active span as failed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L477) |
| `setSpanAttributes` | Sets span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L431) |
| `shutdownOTLP` | Shut down OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L123) |
| `startServerSpan` | Starts server span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L353) |
| `withContext` | Context for with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L485) |
| `withSpan` | Applies span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L278) |
| `withSpanSync` | Applies span sync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L302) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `OTLPConfig` | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L44) |
| `WithSpanOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L273) |
