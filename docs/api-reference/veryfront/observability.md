---
title: "veryfront/observability"
description: "Tracing, metrics, OTLP export, and structured logs."
order: 21
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

| Name             | Description        | Source                                                                                                     |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `SpanKind`       |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L118) |
| `SpanNames`      | Render span names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L1) |
| `SpanStatusCode` |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L128) |

### Functions

| Name                                     | Description                                                          | Source                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `addSpanEvent`                           | Event emitted for add span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L69)                         |
| `createChildSpan`                        | Create child span.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L78)                         |
| `createFileLogSubscriber`                | Create file log subscriber.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L193)                  |
| `createOpenTelemetryServiceTracer`       | Create open telemetry service tracer.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L199)               |
| `endSpan`                                | End an active tracing span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L56)                         |
| `extractContext`                         | Context for extract.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L87)                         |
| `getActiveContext`                       | Context for get active.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L97)                         |
| `getErrorCollector`                      | Return error collector.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L340)                      |
| `getGlobalMetricsAPI`                    |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L450)                     |
| `getHostTelemetryEnv`                    |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L6)                  |
| `getLogBuffer`                           | Return log buffer.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L167)                           |
| `getMetricsState`                        | State for get metrics.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L37)                         |
| `getTraceContext`                        | Context for get trace.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L304)                   |
| `initAutoInstrumentation`                | Initialize automatic instrumentation wrappers.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L12)          |
| `initializeOTLP`                         | Initialize OTLP tracing export.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L103)                   |
| `initMetrics`                            | Initialize metrics collection.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L19)                         |
| `initTracing`                            | Initialize tracing for the current runtime.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L17)                         |
| `injectContext`                          | Context for inject.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L92)                         |
| `instrument`                             | Instrument an async operation.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L5)               |
| `instrumentBatch`                        | Instrument a batch operation.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L49)              |
| `instrumentErrorHandler`                 | Handler for instrument error.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L33) |
| `instrumentFetch`                        | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L83)  |
| `instrumentHttpHandler`                  | Handler for instrument HTTP.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L37)  |
| `instrumentReactRender`                  | Instrument a React render operation.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L5)  |
| `instrumentSync`                         | Instrument a synchronous operation.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L27)              |
| `interceptConsole`                       | Capture console output in the log buffer.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L179)                           |
| `isAutoInstrumentEnabled`                | Check whether auto instrumentation is enabled.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L41)          |
| `isMetricsEnabled`                       | Check whether metrics collection is enabled.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L27)                         |
| `isOTLPEnabled`                          | Check whether OTLP export is enabled.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L121)                   |
| `isReservedSharedRuntimeTelemetryEnvKey` |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L10)                 |
| `isTracingDegraded`                      |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L29)                         |
| `isTracingEnabled`                       | Check whether tracing is enabled.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L25)                         |
| `markRequestProfilePhase`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L114)                     |
| `parseCompileError`                      | Error shape for parse compile.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L352)                      |
| `parseMaxSize`                           | Parses max size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L27)                   |
| `profilePhase`                           |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L101)                     |
| `profileSyncPhase`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L121)                     |
| `recordApiRequest`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L290)      |
| `recordApiRetry`                         |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L304)      |
| `recordBuild`                            | Record build.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L123)                        |
| `recordBundle`                           | Record bundle.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L131)                        |
| `recordCacheGet`                         | Record cache get.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L55)                         |
| `recordCacheInvalidate`                  | Record cache invalidate.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L68)                         |
| `recordCacheSet`                         | Record cache set.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L63)                         |
| `recordContentCacheHit`                  | Record a content cache hit at the specified layer                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L328)      |
| `recordContentNetworkFetch`              | Record a content network fetch with timing                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L354)      |
| `recordCorsRejection`                    | Record CORS rejection.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L152)                        |
| `recordDataFetch`                        | Record data fetch.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L139)                        |
| `recordDataFetchError`                   | Error shape for record data fetch.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L147)                        |
| `recordErrorCount`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L161)                        |
| `recordHttpRequest`                      | Request payload for record HTTP.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L42)                         |
| `recordHttpRequestComplete`              | Record HTTP request complete.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L47)                         |
| `recordRender`                           | Record render.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L81)                         |
| `recordRenderError`                      | Error shape for record render.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L89)                         |
| `recordRSCError`                         | Error shape for record rscerror.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L118)                        |
| `recordRSCRender`                        | Record RSC render.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L94)                         |
| `recordRSCRequest`                       | Request payload for record rscrequest.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L110)                        |
| `recordRSCStream`                        | Record RSC stream.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L102)                        |
| `recordSecurityHeaders`                  | Record security headers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L157)                        |
| `resetErrorCollector`                    | Reset captured runtime errors.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L346)                      |
| `resetLogBuffer`                         | Reset the in-memory log buffer.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L173)                           |
| `setActiveSpanAttributes`                | Sets active span attributes.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L281)                   |
| `setCacheSize`                           | Sets cache size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L76)                         |
| `setSpanAttributes`                      | Sets span attributes.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L61)                         |
| `shutdownMetrics`                        | Shut down metrics collection.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L32)                         |
| `shutdownOTLP`                           | Shut down OTLP tracing export.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L115)                   |
| `shutdownTracing`                        | Shut down the tracing runtime.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L34)                         |
| `snapshotRequestProfiles`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L217)                     |
| `startSpan`                              | Starts span.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L51)                         |
| `withActiveSpan`                         | Applies active span.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L102)                        |
| `withSpan`                               | Applies span.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L109)                        |
| `withSpanSync`                           | Applies span sync.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L128)                        |

### Classes

| Name                | Description                    | Source                                                                                                       |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `ErrorCollector`    | Implement error collector.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L66)     |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L52) |
| `LogBuffer`         | Implement log buffer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L28)          |

### Types

| Name                                      | Description                                               | Source                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AttributeValue`                          |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L29)                 |
| `AutoInstrumentConfig`                    | Configuration used by auto instrument.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L23)            |
| `Context`                                 |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L82)                 |
| `Counter`                                 |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L144)                |
| `CreateOpenTelemetryServiceTracerOptions` | Options accepted by create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L103)          |
| `DevError`                                | Error shape for dev.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L25)                  |
| `ErrorFilter`                             | Public API contract for error filter.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L51)                  |
| `ErrorSubscriber`                         | Public API contract for error subscriber.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L63)                  |
| `ErrorType`                               | Public API contract for error type.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L11)                  |
| `FileLogConfig`                           | Configuration used by file log.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L3)               |
| `Histogram`                               |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L152)                |
| `LogBufferFilter`                         | Filter options for reading buffered log entries.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L16)                       |
| `LogEntry`                                | Entry shape for log.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L7)                        |
| `LogLevel`                                | Public API contract for log level.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L4)                        |
| `LogSubscriber`                           | Public API contract for log subscriber.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L25)                       |
| `Meter`                                   |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L160)                |
| `MetricsConfig`                           | Configuration used by metrics.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L63)                    |
| `ModuleServeStatus`                       |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L131) |
| `ObservableGauge`                         |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L156)                |
| `OpenTelemetryContextApi`                 | Public API contract for open telemetry context API.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L38)           |
| `OpenTelemetryServiceTracer`              | Public API contract for open telemetry service tracer.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L115)          |
| `OpenTelemetrySpan`                       | Public API contract for open telemetry span.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L7)            |
| `OpenTelemetrySpanContext`                | Context for open telemetry span.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L1)            |
| `OpenTelemetryTraceApi`                   | Public API contract for open telemetry trace API.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L31)           |
| `OpenTelemetryTracer`                     | Public API contract for open telemetry tracer.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L25)           |
| `OTLPConfig`                              | Configuration used by otlpconfig.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L36)               |
| `RequestProfileRecord`                    |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L3)                  |
| `ServiceTracer`                           | Public API contract for service tracer.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L85)           |
| `ServiceTracerAttributeInput`             | Input payload for service tracer attribute.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L44)           |
| `ServiceTracerAttributes`                 | Public API contract for service tracer attributes.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L53)           |
| `ServiceTracerAttributeValue`             | Public API contract for service tracer attribute value.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L47)           |
| `ServiceTracerSpan`                       | Public API contract for service tracer span.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L62)           |
| `ServiceTracerSpanContext`                | Context for service tracer span.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L56)           |
| `ServiceTracerStartSpanOptions`           | Options accepted by service tracer start span.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L76)           |
| `Span`                                    |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L31)                 |
| `SpanKind`                                |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L126)                |
| `SpanOptions`                             | Options accepted by span.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L13)                    |
| `SpanStatusCode`                          |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L134)                |
| `TracingConfig`                           | Configuration used by tracing.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L3)                     |

### Constants

| Name      | Description | Source                                                                                                        |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `metrics` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/index.ts#L75) |
| `trace`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L364)    |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/observability/otlp-setup`

*********************** OpenTelemetry OTLP Setup Thin wrapper that delegates to the `ext-observability-opentelemetry` extension via the `TracingExporter` contract. When the extension is not installed, all span operations silently no-op. Reads configuration from environment variables: - OTEL_TRACES_ENABLED: "true" to enable tracing - OTEL_SERVICE_NAME: Service name for traces - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint - OTEL_EXPORTER_OTLP_HEADERS: Auth headers ************************

```ts
import { addSpanEvent, endServerSpan, extractContext } from "veryfront/observability/otlp-setup";
```

#### Functions

| Name                       | Description                                         | Source                                                                                                       |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `addSpanEvent`             | Adds an event to a span.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L269) |
| `endServerSpan`            | End an active server tracing span.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L235) |
| `extractContext`           | Context for extract.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L204) |
| `getTraceContext`          | Context for get trace.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L304) |
| `initializeOTLP`           | Initialize OTLP tracing export.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L103) |
| `initializeOTLPWithApis`   | Initialize OTLP tracing with explicit API adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L126) |
| `injectContext`            | Context for inject.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L212) |
| `isOTLPEnabled`            | Check whether OTLP export is enabled.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L121) |
| `setActiveSpanAttributes`  | Sets active span attributes.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L281) |
| `setActiveSpanErrorStatus` | Marks the active span as failed.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L291) |
| `setSpanAttributes`        | Sets span attributes.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L258) |
| `shutdownOTLP`             | Shut down OTLP tracing export.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L115) |
| `startServerSpan`          | Starts server span.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L219) |
| `withContext`              | Context for with.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L299) |
| `withSpan`                 | Applies span.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L147) |
| `withSpanSync`             | Applies span sync.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L176) |

#### Types

| Name              | Description                       | Source                                                                                                       |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OTLPConfig`      | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L36)  |
| `WithSpanOptions` |                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L142) |
