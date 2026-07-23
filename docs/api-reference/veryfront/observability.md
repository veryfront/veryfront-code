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

| Name             | Description        | Source                                                                                                     |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `SpanKind`       |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L119) |
| `SpanNames`      | Render span names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L2) |
| `SpanStatusCode` |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L129) |

### Functions

| Name                                     | Description                                                          | Source                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `addSpanEvent`                           | Event emitted for add span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L70)                         |
| `createChildSpan`                        | Create child span.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L79)                         |
| `createFileLogSubscriber`                | Create file log subscriber.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L254)                  |
| `createOpenTelemetryServiceTracer`       | Create open telemetry service tracer.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L244)               |
| `endSpan`                                | End an active tracing span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L57)                         |
| `extractContext`                         | Context for extract.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L88)                         |
| `getActiveContext`                       | Context for get active.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L98)                         |
| `getErrorCollector`                      | Return error collector.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L379)                      |
| `getGlobalMetricsAPI`                    |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L451)                     |
| `getHostTelemetryEnv`                    |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L7)                  |
| `getLogBuffer`                           | Return log buffer.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L201)                           |
| `getMetricsState`                        | State for get metrics.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L38)                         |
| `getTraceContext`                        | Context for get trace.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L446)                   |
| `initAutoInstrumentation`                | Initialize automatic instrumentation wrappers.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L13)          |
| `initializeOTLP`                         | Initialize OTLP tracing export.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L109)                   |
| `initMetrics`                            | Initialize metrics collection.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L20)                         |
| `initTracing`                            | Initialize tracing for the current runtime.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L18)                         |
| `injectContext`                          | Context for inject.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L93)                         |
| `instrument`                             | Instrument an async operation.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L6)               |
| `instrumentBatch`                        | Instrument a batch operation.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L50)              |
| `instrumentErrorHandler`                 | Handler for instrument error.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L36) |
| `instrumentFetch`                        | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L105) |
| `instrumentHttpHandler`                  | Handler for instrument HTTP.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L51)  |
| `instrumentReactRender`                  | Instrument a React render operation.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L8)  |
| `instrumentSync`                         | Instrument a synchronous operation.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L28)              |
| `interceptConsole`                       | Capture console output in the log buffer.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L213)                           |
| `isAutoInstrumentEnabled`                | Check whether auto instrumentation is enabled.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L42)          |
| `isMetricsEnabled`                       | Check whether metrics collection is enabled.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L28)                         |
| `isOTLPEnabled`                          | Check whether OTLP export is enabled.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L127)                   |
| `isReservedSharedRuntimeTelemetryEnvKey` |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L11)                 |
| `isTracingDegraded`                      |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L30)                         |
| `isTracingEnabled`                       | Check whether tracing is enabled.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L26)                         |
| `markRequestProfilePhase`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L114)                     |
| `parseCompileError`                      | Error shape for parse compile.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L391)                      |
| `parseMaxSize`                           | Parses max size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L33)                   |
| `profilePhase`                           |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L101)                     |
| `profileSyncPhase`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L121)                     |
| `recordApiRequest`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L304)      |
| `recordApiRetry`                         |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L318)      |
| `recordBuild`                            | Record build.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L124)                        |
| `recordBundle`                           | Record bundle.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L132)                        |
| `recordCacheGet`                         | Record cache get.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L56)                         |
| `recordCacheInvalidate`                  | Record cache invalidate.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L69)                         |
| `recordCacheSet`                         | Record cache set.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L64)                         |
| `recordContentCacheHit`                  | Record a content cache hit at the specified layer                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L340)      |
| `recordContentNetworkFetch`              | Record a content network fetch with timing                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L366)      |
| `recordCorsRejection`                    | Record CORS rejection.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L153)                        |
| `recordDataFetch`                        | Record data fetch.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L140)                        |
| `recordDataFetchError`                   | Error shape for record data fetch.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L148)                        |
| `recordErrorCount`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L162)                        |
| `recordHttpRequest`                      | Request payload for record HTTP.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L43)                         |
| `recordHttpRequestComplete`              | Record HTTP request complete.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L48)                         |
| `recordRender`                           | Record render.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L82)                         |
| `recordRenderError`                      | Error shape for record render.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L90)                         |
| `recordRSCError`                         | Error shape for record rscerror.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L119)                        |
| `recordRSCRender`                        | Record RSC render.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L95)                         |
| `recordRSCRequest`                       | Request payload for record rscrequest.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L111)                        |
| `recordRSCStream`                        | Record RSC stream.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L103)                        |
| `recordSecurityHeaders`                  | Record security headers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L158)                        |
| `resetErrorCollector`                    | Reset captured runtime errors.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L385)                      |
| `resetLogBuffer`                         | Reset the in-memory log buffer.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L207)                           |
| `setActiveSpanAttributes`                | Sets active span attributes.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L418)                   |
| `setCacheSize`                           | Sets cache size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L77)                         |
| `setSpanAttributes`                      | Sets span attributes.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L62)                         |
| `shutdownMetrics`                        | Shut down metrics collection.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L33)                         |
| `shutdownOTLP`                           | Shut down OTLP tracing export.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L121)                   |
| `shutdownTracing`                        | Shut down the tracing runtime.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L35)                         |
| `snapshotRequestProfiles`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L206)                     |
| `startSpan`                              | Starts span.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L52)                         |
| `withActiveSpan`                         | Applies active span.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L103)                        |
| `withSpan`                               | Applies span.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L110)                        |
| `withSpanSync`                           | Applies span sync.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L129)                        |

### Classes

| Name                | Description                    | Source                                                                                                       |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `ErrorCollector`    | Implement error collector.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L87)     |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L84) |
| `LogBuffer`         | Implement log buffer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L38)          |

### Types

| Name                                      | Description                                               | Source                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AttributeValue`                          |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L30)                 |
| `AutoInstrumentConfig`                    | Configuration used by auto instrument.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L24)            |
| `Context`                                 |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L83)                 |
| `Counter`                                 |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L145)                |
| `CreateOpenTelemetryServiceTracerOptions` | Options accepted by create open telemetry service tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L110)          |
| `DevError`                                | Error shape for dev.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L29)                  |
| `ErrorFilter`                             | Public API contract for error filter.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L55)                  |
| `ErrorSubscriber`                         | Public API contract for error subscriber.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L67)                  |
| `ErrorType`                               | Public API contract for error type.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L15)                  |
| `FileLogConfig`                           | Configuration used by file log.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L9)               |
| `Histogram`                               |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L153)                |
| `LogBufferFilter`                         | Filter options for reading buffered log entries.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L19)                       |
| `LogEntry`                                | Entry shape for log.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L10)                       |
| `LogLevel`                                | Public API contract for log level.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L7)                        |
| `LogSubscriber`                           | Public API contract for log subscriber.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L28)                       |
| `Meter`                                   |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L161)                |
| `MetricsConfig`                           | Configuration used by metrics.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L64)                    |
| `ModuleServeStatus`                       |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L147) |
| `ObservableGauge`                         |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L157)                |
| `OpenTelemetryContextApi`                 | Public API contract for open telemetry context API.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L45)           |
| `OpenTelemetryServiceTracer`              | Public API contract for open telemetry service tracer.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L122)          |
| `OpenTelemetrySpan`                       | Public API contract for open telemetry span.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L14)           |
| `OpenTelemetrySpanContext`                | Context for open telemetry span.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L8)            |
| `OpenTelemetryTraceApi`                   | Public API contract for open telemetry trace API.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L38)           |
| `OpenTelemetryTracer`                     | Public API contract for open telemetry tracer.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L32)           |
| `OTLPConfig`                              | Configuration used by otlpconfig.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L42)               |
| `RequestProfileRecord`                    |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L4)                  |
| `ServiceTracer`                           | Public API contract for service tracer.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L92)           |
| `ServiceTracerAttributeInput`             | Input payload for service tracer attribute.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L51)           |
| `ServiceTracerAttributes`                 | Public API contract for service tracer attributes.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L60)           |
| `ServiceTracerAttributeValue`             | Public API contract for service tracer attribute value.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L54)           |
| `ServiceTracerSpan`                       | Public API contract for service tracer span.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L69)           |
| `ServiceTracerSpanContext`                | Context for service tracer span.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L63)           |
| `ServiceTracerStartSpanOptions`           | Options accepted by service tracer start span.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L83)           |
| `Span`                                    |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L32)                 |
| `SpanKind`                                |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L127)                |
| `SpanOptions`                             | Options accepted by span.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L14)                    |
| `SpanStatusCode`                          |                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L135)                |
| `TracingConfig`                           | Configuration used by tracing.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L4)                     |

### Constants

| Name      | Description | Source                                                                                                        |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `metrics` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/index.ts#L76) |
| `trace`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L365)    |

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
| `addSpanEvent`             | Adds an event to a span.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L403) |
| `endServerSpan`            | End an active server tracing span.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L355) |
| `extractContext`           | Context for extract.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L318) |
| `getTraceContext`          | Context for get trace.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L446) |
| `initializeOTLP`           | Initialize OTLP tracing export.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L109) |
| `initializeOTLPWithApis`   | Initialize OTLP tracing with explicit API adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L132) |
| `injectContext`            | Context for inject.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L326) |
| `isOTLPEnabled`            | Check whether OTLP export is enabled.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L127) |
| `setActiveSpanAttributes`  | Sets active span attributes.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L418) |
| `setActiveSpanErrorStatus` | Marks the active span as failed.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L433) |
| `setSpanAttributes`        | Sets span attributes.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L387) |
| `shutdownOTLP`             | Shut down OTLP tracing export.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L121) |
| `startServerSpan`          | Starts server span.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L333) |
| `withContext`              | Context for with.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L441) |
| `withSpan`                 | Applies span.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L233) |
| `withSpanSync`             | Applies span sync.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L274) |

#### Types

| Name              | Description                       | Source                                                                                                       |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OTLPConfig`      | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L42)  |
| `WithSpanOptions` |                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L228) |
