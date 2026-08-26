---
title: "veryfront/observability"
description: "Tracing, metrics, OTLP export, and structured logs."
order: 23
---

## Import

```ts
import {
  addSpanEvent,
  captureApplicationError,
  createChildSpan,
  createFileLogSubscriber,
  createOpenTelemetryServiceTracer,
  endSpan,
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

| Name                                      | Description                                                                    | Source                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `ApplicationErrorReporterInitializerName` | Contract name used when an application composes a reporter through extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L30) |
| `SpanKind`                                |                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L139)                     |
| `SpanNames`                               | Render span names.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L2)                     |
| `SpanStatusCode`                          |                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L149)                     |

### Functions

| Name                                     | Description                                                          | Source                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `addSpanEvent`                           | Event emitted for add span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L70)                         |
| `captureApplicationError`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L266)                   |
| `createChildSpan`                        | Create child span.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L79)                         |
| `createFileLogSubscriber`                | Create file log subscriber.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L541)                  |
| `createOpenTelemetryServiceTracer`       | Create open telemetry service tracer.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L364)               |
| `endSpan`                                | End an active tracing span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L57)                         |
| `extractContext`                         | Context for extract.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L88)                         |
| `flushApplicationErrors`                 |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L294)                   |
| `getActiveContext`                       | Context for get active.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L98)                         |
| `getGlobalMetricsAPI`                    |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L701)                     |
| `getMetricsState`                        | State for get metrics.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L38)                         |
| `getTraceContext`                        |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L651)                   |
| `injectContext`                          | Context for inject.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L93)                         |
| `instrument`                             | Instrument an async operation.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L6)               |
| `instrumentBatch`                        | Instrument a batch operation.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L50)              |
| `instrumentErrorHandler`                 | Handler for instrument error.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L35) |
| `instrumentFetch`                        | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L129) |
| `instrumentHttpHandler`                  | Handler for instrument HTTP.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L85)  |
| `instrumentReactRender`                  | Instrument a React render operation.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L8)  |
| `instrumentSync`                         | Instrument a synchronous operation.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L28)              |
| `isAutoInstrumentEnabled`                | Check whether auto instrumentation is enabled.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L56)          |
| `isMetricsEnabled`                       | Check whether metrics collection is enabled.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L28)                         |
| `isOTLPEnabled`                          | Check whether OTLP export is enabled.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L135)                   |
| `isReservedSharedRuntimeTelemetryEnvKey` |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L11)                 |
| `isTracingDegraded`                      |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L30)                         |
| `isTracingEnabled`                       | Check whether tracing is enabled.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L26)                         |
| `markRequestProfilePhase`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L204)                     |
| `parseCompileError`                      | Error shape for parse compile.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L418)                      |
| `parseMaxSize`                           | Parses max size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L47)                   |
| `profilePhase`                           |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L191)                     |
| `profileSyncPhase`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L211)                     |
| `recordApiRequest`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L326)      |
| `recordApiRetry`                         |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L341)      |
| `recordBuild`                            | Record build.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L124)                        |
| `recordBundle`                           | Record bundle.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L132)                        |
| `recordCacheGet`                         | Record cache get.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L56)                         |
| `recordCacheInvalidate`                  | Record cache invalidate.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L69)                         |
| `recordCacheSet`                         | Record cache set.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L64)                         |
| `recordContentCacheHit`                  | Record a content cache hit at the specified layer                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L363)      |
| `recordContentNetworkFetch`              | Record a content network fetch with timing                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L389)      |
| `recordCorsRejection`                    | Record CORS rejection.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L165)                        |
| `recordDataFetch`                        | Record data fetch.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L152)                        |
| `recordDataFetchError`                   | Error shape for record data fetch.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L160)                        |
| `recordErrorCount`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L174)                        |
| `recordHttpRequest`                      | Request payload for record HTTP.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L43)                         |
| `recordHttpRequestComplete`              | Record HTTP request complete.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L48)                         |
| `recordRender`                           | Record render.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L82)                         |
| `recordRenderError`                      | Error shape for record render.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L90)                         |
| `recordRSCError`                         | Error shape for record rscerror.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L119)                        |
| `recordRSCRender`                        | Record RSC render.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L95)                         |
| `recordRSCRequest`                       | Request payload for record rscrequest.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L111)                        |
| `recordRSCStream`                        | Record RSC stream.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L103)                        |
| `recordSecurityHeaders`                  | Record security headers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L170)                        |
| `setActiveSpanAttributes`                | Sets active span attributes.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L564)                   |
| `setCacheSize`                           | Sets cache size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L77)                         |
| `setSpanAttributes`                      | Sets span attributes.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L62)                         |
| `startSpan`                              | Starts span.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L52)                         |
| `withActiveSpan`                         | Applies active span.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L103)                        |
| `withSpan`                               | Applies span.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L110)                        |
| `withSpanSync`                           | Applies span sync.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L132)                        |

### Classes

| Name                | Description                    | Source                                                                                                        |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `ErrorCollector`    | Implement error collector.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L91)      |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L174) |
| `LogBuffer`         | Implement log buffer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L38)           |

### Types

| Name                                            | Description                                                                     | Source                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ApplicationErrorContext`                       | Sanitized context attached when a runtime reports an application error.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L5)             |
| `ApplicationErrorReporter`                      | Provider-neutral application error capture and flush interface.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L27)            |
| `ApplicationErrorReporterInitializationContext` | Runtime context passed to an explicitly selected reporter initializer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L9)  |
| `ApplicationErrorReporterInitializer`           | Application-composition contract for an error-reporting implementation.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L20) |
| `ApplicationErrorReporterLifecycle`             | Active application-error reporter ownership.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L29)                    |
| `ApplicationErrorReporterSession`               | Reporter and cleanup ownership returned by an application-selected initializer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L14) |
| `AttributeValue`                                |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L33)                      |
| `AutoInstrumentConfig`                          | Configuration used by auto instrument.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L24)                 |
| `Context`                                       |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L103)                     |
| `Counter`                                       |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L165)                     |
| `CreateOpenTelemetryServiceTracerOptions`       | Options accepted by create open telemetry service tracer.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L118)               |
| `DevError`                                      | Error shape for dev.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L33)                       |
| `ErrorFilter`                                   | Public API contract for error filter.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L59)                       |
| `ErrorSubscriber`                               | Public API contract for error subscriber.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L71)                       |
| `ErrorType`                                     | Public API contract for error type.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L15)                       |
| `FileLogConfig`                                 | Configuration used by file log.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L16)                   |
| `Histogram`                                     |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L173)                     |
| `LogBufferFilter`                               | Filter options for reading buffered log entries.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L19)                            |
| `LogEntry`                                      | Entry shape for log.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L10)                            |
| `LogLevel`                                      | Public API contract for log level.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L7)                             |
| `LogSubscriber`                                 | Public API contract for log subscriber.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L28)                            |
| `Meter`                                         |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L182)                     |
| `MetricsConfig`                                 | Configuration used by metrics.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L80)                         |
| `ModuleServeStatus`                             |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L144)      |
| `ObservableGauge`                               |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L177)                     |
| `OpenTelemetryContextApi`                       | Public API contract for open telemetry context API.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L53)                |
| `OpenTelemetryServiceTracer`                    | Public API contract for open telemetry service tracer.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L130)               |
| `OpenTelemetrySpan`                             | Public API contract for open telemetry span.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L22)                |
| `OpenTelemetrySpanContext`                      | Context for open telemetry span.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L16)                |
| `OpenTelemetryTraceApi`                         | Public API contract for open telemetry trace API.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L46)                |
| `OpenTelemetryTracer`                           | Public API contract for open telemetry tracer.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L40)                |
| `OTLPConfig`                                    | Configuration used by otlpconfig.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L50)                    |
| `RequestProfileRecord`                          |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L15)                      |
| `ServiceTracer`                                 | Public API contract for service tracer.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L100)               |
| `ServiceTracerAttributeInput`                   | Input payload for service tracer attribute.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L59)                |
| `ServiceTracerAttributes`                       | Public API contract for service tracer attributes.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L68)                |
| `ServiceTracerAttributeValue`                   | Public API contract for service tracer attribute value.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L62)                |
| `ServiceTracerSpan`                             | Public API contract for service tracer span.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L77)                |
| `ServiceTracerSpanContext`                      | Context for service tracer span.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L71)                |
| `ServiceTracerStartSpanOptions`                 | Options accepted by service tracer start span.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L91)                |
| `Span`                                          |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L35)                      |
| `SpanKind`                                      |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L147)                     |
| `SpanOptions`                                   | Options accepted by span.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L14)                         |
| `SpanStatusCode`                                |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L155)                     |
| `TracingConfig`                                 | Configuration used by tracing.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L4)                          |

### Constants

| Name      | Description                                                                | Source                                                                                                        |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `metrics` |                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/index.ts#L78) |
| `trace`   | Read-only tracing facade for the public `veryfront/observability` surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L640)    |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/observability/otlp-setup`

*********************** OpenTelemetry OTLP Setup Thin wrapper that delegates to the `ext-observability-opentelemetry` extension via the `TracingExporter` contract. When the extension is not installed, all span operations silently no-op. Reads configuration from environment variables: - OTEL_TRACES_ENABLED: "true" to enable tracing - OTEL_SERVICE_NAME: Service name for traces - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint - OTEL_EXPORTER_OTLP_HEADERS: Auth headers ************************

```ts
import {
  activeSpanLink,
  addActiveSpanEvent,
  addSpanEvent,
} from "veryfront/observability/otlp-setup";
```

#### Functions

| Name                       | Description                                                                              | Source                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `activeSpanLink`           | A link to the span that is active right now, for a span about to be rooted away from it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L645) |
| `addActiveSpanEvent`       | Records an event on the currently active span, if there is one.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L579) |
| `addSpanEvent`             | Adds an event to a span.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L545) |
| `endServerSpan`            | End an active server tracing span.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L495) |
| `extractContext`           | Context for extract.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L426) |
| `getActiveTraceparent`     | The active span's identity as a `traceparent`, for storing somewhere durable.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L616) |
| `getTraceContext`          |                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L651) |
| `initializeOTLP`           | Initialize OTLP tracing export.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L117) |
| `initializeOTLPWithApis`   | Initialize OTLP tracing with explicit API adapters.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L140) |
| `injectContext`            | Context for inject.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L438) |
| `isOTLPEnabled`            | Check whether OTLP export is enabled.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L135) |
| `setActiveSpanAttributes`  | Sets active span attributes.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L564) |
| `setActiveSpanErrorStatus` | Marks the active span as failed.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L593) |
| `setSpanAttributes`        | Sets span attributes.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L529) |
| `shutdownOTLP`             | Shut down OTLP tracing export.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L129) |
| `startServerSpan`          | Starts server span.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L449) |
| `traceparentLink`          | Build a span link from a `traceparent` read back out of durable storage.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L633) |
| `withContext`              | Context for with.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L601) |
| `withSpan`                 | Applies span.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L374) |
| `withSpanSync`             | Applies span sync.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L398) |

#### Types

| Name              | Description                       | Source                                                                                                       |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OTLPConfig`      | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L50)  |
| `WithSpanOptions` |                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L293) |
