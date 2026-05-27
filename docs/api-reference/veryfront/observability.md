---
title: "veryfront/observability"
description: "Tracing, metrics, OTLP export, and structured logs."
order: 19
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
| `SpanNames` | Render span names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L1) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addSpanEvent` | Event emitted for add span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L69) |
| `createChildSpan` | Create child span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L78) |
| `createFileLogSubscriber` | Create file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L187) |
| `createOpenTelemetryServiceTracer` | Create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L176) |
| `endSpan` | End an active tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L56) |
| `extractContext` | Context for extract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L87) |
| `getActiveContext` | Context for get active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L97) |
| `getErrorCollector` | Return error collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L347) |
| `getLogBuffer` | Return log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L168) |
| `getMetricsState` | State for get metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L37) |
| `initAutoInstrumentation` | Initialize automatic instrumentation wrappers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L12) |
| `initializeOTLP` | Initialize OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L78) |
| `initMetrics` | Initialize metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L19) |
| `initTracing` | Initialize tracing for the current runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L17) |
| `injectContext` | Context for inject. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L92) |
| `instrument` | Instrument an async operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L5) |
| `instrumentBatch` | Instrument a batch operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L49) |
| `instrumentErrorHandler` | Handler for instrument error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L33) |
| `instrumentFetch` | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L71) |
| `instrumentHttpHandler` | Handler for instrument HTTP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L34) |
| `instrumentReactRender` | Instrument a React render operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L5) |
| `instrumentSync` | Instrument a synchronous operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L27) |
| `interceptConsole` | Capture console output in the log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L180) |
| `isAutoInstrumentEnabled` | Check whether auto instrumentation is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L41) |
| `isMetricsEnabled` | Check whether metrics collection is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L27) |
| `isOTLPEnabled` | Check whether OTLP export is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L96) |
| `isTracingEnabled` | Check whether tracing is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L25) |
| `parseCompileError` | Error shape for parse compile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L359) |
| `parseMaxSize` | Parses max size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L27) |
| `recordBuild` | Record build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L123) |
| `recordBundle` | Record bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L131) |
| `recordCacheGet` | Record cache get. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L55) |
| `recordCacheInvalidate` | Record cache invalidate. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L68) |
| `recordCacheSet` | Record cache set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L63) |
| `recordCorsRejection` | Record CORS rejection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L152) |
| `recordDataFetch` | Record data fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L139) |
| `recordDataFetchError` | Error shape for record data fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L147) |
| `recordHttpRequest` | Request payload for record HTTP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L42) |
| `recordHttpRequestComplete` | Record HTTP request complete. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L47) |
| `recordRender` | Record render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L81) |
| `recordRenderError` | Error shape for record render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L89) |
| `recordRSCError` | Error shape for record rscerror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L118) |
| `recordRSCRender` | Record RSC render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L94) |
| `recordRSCRequest` | Request payload for record rscrequest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L110) |
| `recordRSCStream` | Record RSC stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L102) |
| `recordSecurityHeaders` | Record security headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L157) |
| `resetErrorCollector` | Reset captured runtime errors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L353) |
| `resetLogBuffer` | Reset the in-memory log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L174) |
| `setCacheSize` | Sets cache size. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L76) |
| `setSpanAttributes` | Sets span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L61) |
| `shutdownMetrics` | Shut down metrics collection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L32) |
| `shutdownOTLP` | Shut down OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L90) |
| `shutdownTracing` | Shut down the tracing runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L34) |
| `startSpan` | Starts span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L51) |
| `withActiveSpan` | Applies active span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L102) |
| `withSpan` | Applies span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L109) |
| `withSpanSync` | Applies span sync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L128) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ErrorCollector` | Implement error collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L66) |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L52) |
| `LogBuffer` | Implement log buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L25) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AutoInstrumentConfig` | Configuration used by auto instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L23) |
| `CreateOpenTelemetryServiceTracerOptions` | Options accepted by create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L95) |
| `DevError` | Error shape for dev. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L25) |
| `ErrorFilter` | Public API contract for error filter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L51) |
| `ErrorSubscriber` | Public API contract for error subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L63) |
| `ErrorType` | Public API contract for error type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L11) |
| `FileLogConfig` | Configuration used by file log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L3) |
| `LogBufferFilter` | Filter options for reading buffered log entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L13) |
| `LogEntry` | Entry shape for log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L4) |
| `LogLevel` | Public API contract for log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L1) |
| `LogSubscriber` | Public API contract for log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L22) |
| `MetricsConfig` | Configuration used by metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L63) |
| `OpenTelemetryContextApi` | Public API contract for open telemetry context API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L30) |
| `OpenTelemetryServiceTracer` | Public API contract for open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L107) |
| `OpenTelemetrySpan` | Public API contract for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L7) |
| `OpenTelemetrySpanContext` | Context for open telemetry span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L1) |
| `OpenTelemetryTraceApi` | Public API contract for open telemetry trace API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L23) |
| `OpenTelemetryTracer` | Public API contract for open telemetry tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L17) |
| `OTLPConfig` | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L33) |
| `ServiceTracer` | Public API contract for service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L77) |
| `ServiceTracerAttributeInput` | Input payload for service tracer attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L36) |
| `ServiceTracerAttributes` | Public API contract for service tracer attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L45) |
| `ServiceTracerAttributeValue` | Public API contract for service tracer attribute value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L39) |
| `ServiceTracerSpan` | Public API contract for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L54) |
| `ServiceTracerSpanContext` | Context for service tracer span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L48) |
| `ServiceTracerStartSpanOptions` | Options accepted by service tracer start span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L68) |
| `SpanOptions` | Options accepted by span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L13) |
| `TracingConfig` | Configuration used by tracing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L3) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/observability/otlp-setup`

*********************** OpenTelemetry OTLP Setup Thin wrapper that delegates to the `ext-observability-opentelemetry` extension via the `TracingExporter` contract. When the extension is not installed, all span operations silently no-op. Reads configuration from environment variables: - OTEL_TRACES_ENABLED: "true" to enable tracing - OTEL_SERVICE_NAME: Service name for traces - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint - OTEL_EXPORTER_OTLP_HEADERS: Auth headers ************************

```ts
import { endServerSpan, extractContext, getTraceContext } from "veryfront/observability/otlp-setup";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `endServerSpan` | End an active server tracing span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L208) |
| `extractContext` | Context for extract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L176) |
| `getTraceContext` | Context for get trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L257) |
| `initializeOTLP` | Initialize OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L78) |
| `initializeOTLPWithApis` | Initialize OTLP tracing with explicit API adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L101) |
| `injectContext` | Context for inject. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L184) |
| `isOTLPEnabled` | Check whether OTLP export is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L96) |
| `setActiveSpanAttributes` | Sets active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L242) |
| `setSpanAttributes` | Sets span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L231) |
| `shutdownOTLP` | Shut down OTLP tracing export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L90) |
| `startServerSpan` | Starts server span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L191) |
| `withContext` | Context for with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L252) |
| `withSpan` | Applies span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L118) |
| `withSpanSync` | Applies span sync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L148) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `OTLPConfig` | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L33) |
