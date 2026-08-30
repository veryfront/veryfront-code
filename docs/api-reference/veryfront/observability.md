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

| Name                                      | Description                                                                    | Source                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `ApplicationErrorReporterInitializerName` | Contract name used when an application composes a reporter through extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `SpanKind`                                |                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `SpanNames`                               | Render span names.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts)                    |
| `SpanStatusCode`                          |                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |

### Functions

| Name                                     | Description                                                          | Source                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `addSpanEvent`                           | Event emitted for add span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `captureApplicationError`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts)                    |
| `createChildSpan`                        | Create child span.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `createFileLogSubscriber`                | Create file log subscriber.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts)                   |
| `createOpenTelemetryServiceTracer`       | Create open telemetry service tracer.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `endSpan`                                | End an active tracing span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `extractContext`                         | Context for extract.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `flushApplicationErrors`                 |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts)                    |
| `getActiveContext`                       | Context for get active.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `getTraceContext`                        |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts)                    |
| `injectContext`                          | Context for inject.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `instrument`                             | Instrument an async operation.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts)              |
| `instrumentBatch`                        | Instrument a batch operation.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts)              |
| `instrumentErrorHandler`                 | Handler for instrument error.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts) |
| `instrumentFetch`                        | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts)  |
| `instrumentHttpHandler`                  | Handler for instrument HTTP.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts)  |
| `instrumentReactRender`                  | Instrument a React render operation.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts) |
| `instrumentSync`                         | Instrument a synchronous operation.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts)              |
| `isAutoInstrumentEnabled`                | Check whether auto instrumentation is enabled.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts)          |
| `isMetricsEnabled`                       | Check whether metrics collection is enabled.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `isOTLPEnabled`                          | Check whether OTLP export is enabled.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts)                    |
| `isReservedSharedRuntimeTelemetryEnvKey` |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts)                 |
| `isTracingDegraded`                      |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `isTracingEnabled`                       | Check whether tracing is enabled.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `markRequestProfilePhase`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts)                      |
| `parseCompileError`                      | Error shape for parse compile.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts)                       |
| `parseMaxSize`                           | Parses max size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts)                   |
| `profilePhase`                           |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts)                      |
| `profileSyncPhase`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts)                      |
| `recordApiRequest`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts)       |
| `recordApiRetry`                         |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts)       |
| `recordBuild`                            | Record build.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordBundle`                           | Record bundle.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordCacheGet`                         | Record cache get.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordCacheInvalidate`                  | Record cache invalidate.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordCacheSet`                         | Record cache set.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordContentCacheHit`                  | Record a content cache hit at the specified layer                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts)       |
| `recordContentNetworkFetch`              | Record a content network fetch with timing                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts)       |
| `recordCorsRejection`                    | Record CORS rejection.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordDataFetch`                        | Record data fetch.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordDataFetchError`                   | Error shape for record data fetch.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordErrorCount`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordHttpRequest`                      | Request payload for record HTTP.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordHttpRequestComplete`              | Record HTTP request complete.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordRender`                           | Record render.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordRenderError`                      | Error shape for record render.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordRSCError`                         | Error shape for record rscerror.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordRSCRender`                        | Record RSC render.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordRSCRequest`                       | Request payload for record rscrequest.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordRSCStream`                        | Record RSC stream.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `recordSecurityHeaders`                  | Record security headers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `setActiveSpanAttributes`                | Sets active span attributes.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts)                    |
| `setCacheSize`                           | Sets cache size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts)                         |
| `setSpanAttributes`                      | Sets span attributes.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `startSpan`                              | Starts span.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `withActiveSpan`                         | Applies active span.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `withSpan`                               | Applies span.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |
| `withSpanSync`                           | Applies span sync.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts)                         |

### Classes

| Name                | Description                    | Source                                                                                                   |
| ------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `ErrorCollector`    | Implement error collector.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts)     |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts) |
| `LogBuffer`         | Implement log buffer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts)          |

### Types

| Name                                            | Description                                                                     | Source                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ApplicationErrorContext`                       | Sanitized context attached when a runtime reports an application error.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts)            |
| `ApplicationErrorReporter`                      | Provider-neutral application error capture and flush interface.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts)            |
| `ApplicationErrorReporterInitializationContext` | Runtime context passed to an explicitly selected reporter initializer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `ApplicationErrorReporterInitializer`           | Application-composition contract for an error-reporting implementation.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `ApplicationErrorReporterLifecycle`             | Active application-error reporter ownership.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts)                    |
| `ApplicationErrorReporterSession`               | Reporter and cleanup ownership returned by an application-selected initializer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `AttributeValue`                                |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `AutoInstrumentConfig`                          | Configuration used by auto instrument.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts)                 |
| `Context`                                       |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `Counter`                                       |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `CreateOpenTelemetryServiceTracerOptions`       | Options accepted by create open telemetry service tracer.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `DevError`                                      | Error shape for dev.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts)                       |
| `ErrorFilter`                                   | Public API contract for error filter.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts)                       |
| `ErrorSubscriber`                               | Public API contract for error subscriber.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts)                       |
| `ErrorType`                                     | Public API contract for error type.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts)                       |
| `FileLogConfig`                                 | Configuration used by file log.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts)                   |
| `Histogram`                                     |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `LogBufferFilter`                               | Filter options for reading buffered log entries.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts)                            |
| `LogEntry`                                      | Entry shape for log.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts)                            |
| `LogLevel`                                      | Public API contract for log level.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts)                            |
| `LogSubscriber`                                 | Public API contract for log subscriber.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts)                            |
| `Meter`                                         |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `MetricsConfig`                                 | Configuration used by metrics.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts)                         |
| `ModuleServeStatus`                             |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts)       |
| `ObservableGauge`                               |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `OpenTelemetryContextApi`                       | Public API contract for open telemetry context API.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `OpenTelemetryServiceTracer`                    | Public API contract for open telemetry service tracer.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `OpenTelemetrySpan`                             | Public API contract for open telemetry span.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `OpenTelemetrySpanContext`                      | Context for open telemetry span.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `OpenTelemetryTraceApi`                         | Public API contract for open telemetry trace API.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `OpenTelemetryTracer`                           | Public API contract for open telemetry tracer.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `OTLPConfig`                                    | Configuration used by otlpconfig.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts)                    |
| `RequestProfileRecord`                          |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts)                      |
| `ServiceTracer`                                 | Public API contract for service tracer.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `ServiceTracerAttributeInput`                   | Input payload for service tracer attribute.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `ServiceTracerAttributes`                       | Public API contract for service tracer attributes.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `ServiceTracerAttributeValue`                   | Public API contract for service tracer attribute value.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `ServiceTracerSpan`                             | Public API contract for service tracer span.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `ServiceTracerSpanContext`                      | Context for service tracer span.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `ServiceTracerStartSpanOptions`                 | Options accepted by service tracer start span.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts)                |
| `Span`                                          |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `SpanKind`                                      |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `SpanOptions`                                   | Options accepted by span.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts)                         |
| `SpanStatusCode`                                |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts)                      |
| `TracingConfig`                                 | Configuration used by tracing.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts)                         |

### Constants

| Name      | Description                                                                | Source                                                                                                |
| --------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `metrics` |                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/index.ts)            |
| `trace`   | Read-only tracing facade for the public `veryfront/observability` surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts) |

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

| Name                       | Description                                                                              | Source                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `activeSpanLink`           | A link to the span that is active right now, for a span about to be rooted away from it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `addActiveSpanEvent`       | Records an event on the currently active span, if there is one.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `addSpanEvent`             | Adds an event to a span.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `endServerSpan`            | End an active server tracing span.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `extractContext`           | Context for extract.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `getActiveTraceparent`     | The active span's identity as a `traceparent`, for storing somewhere durable.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `getTraceContext`          |                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `initializeOTLP`           | Initialize OTLP tracing export.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `initializeOTLPWithApis`   | Initialize OTLP tracing with explicit API adapters.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `injectContext`            | Context for inject.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `isOTLPEnabled`            | Check whether OTLP export is enabled.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `setActiveSpanAttributes`  | Sets active span attributes.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `setActiveSpanErrorStatus` | Marks the active span as failed.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `setSpanAttributes`        | Sets span attributes.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `shutdownOTLP`             | Shut down OTLP tracing export.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `startServerSpan`          | Starts server span.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `traceparentLink`          | Build a span link from a `traceparent` read back out of durable storage.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `withContext`              | Context for with.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `withSpan`                 | Applies span.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `withSpanSync`             | Applies span sync.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |

#### Types

| Name              | Description                       | Source                                                                                                  |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `OTLPConfig`      | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
| `WithSpanOptions` |                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts) |
