---
title: "veryfront/observability"
description: "Tracing, metrics, OTLP export, and structured logs."
order: 22
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
| `ApplicationErrorReporterInitializerName` | Contract name used when an application composes a reporter through extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L29) |
| `SpanKind`                                |                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L121)                     |
| `SpanNames`                               | Render span names.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts#L1)                     |
| `SpanStatusCode`                          |                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L131)                     |

### Functions

| Name                                     | Description                                                          | Source                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `addSpanEvent`                           | Event emitted for add span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L69)                         |
| `captureApplicationError`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L265)                   |
| `createChildSpan`                        | Create child span.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L78)                         |
| `createFileLogSubscriber`                | Create file log subscriber.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L540)                  |
| `createOpenTelemetryServiceTracer`       | Create open telemetry service tracer.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L363)               |
| `endSpan`                                | End an active tracing span.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L56)                         |
| `extractContext`                         | Context for extract.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L87)                         |
| `flushApplicationErrors`                 |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L293)                   |
| `getActiveContext`                       | Context for get active.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L97)                         |
| `getErrorCollector`                      | Return error collector.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L405)                      |
| `getGlobalMetricsAPI`                    |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L666)                     |
| `getHostTelemetryEnv`                    |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L6)                  |
| `getLogBuffer`                           | Return log buffer.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L230)                           |
| `getMetricsState`                        | State for get metrics.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L37)                         |
| `getTraceContext`                        | Context for get trace.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L499)                   |
| `initAutoInstrumentation`                | Initialize automatic instrumentation wrappers.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L14)          |
| `initializeApplicationErrorReporter`     | Activate an explicitly selected reporter initializer.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L152)                   |
| `initializeOTLP`                         | Initialize OTLP tracing export.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L112)                   |
| `initMetrics`                            | Initialize metrics collection.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L19)                         |
| `initTracing`                            | Initialize tracing for the current runtime.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L17)                         |
| `injectContext`                          | Context for inject.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L92)                         |
| `instrument`                             | Instrument an async operation.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L5)               |
| `instrumentBatch`                        | Instrument a batch operation.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L49)              |
| `instrumentErrorHandler`                 | Handler for instrument error.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L34) |
| `instrumentFetch`                        | Create a fetch implementation instrumented with observability spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L128) |
| `instrumentHttpHandler`                  | Handler for instrument HTTP.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L84)  |
| `instrumentReactRender`                  | Instrument a React render operation.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L7)  |
| `instrumentSync`                         | Instrument a synchronous operation.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L27)              |
| `interceptConsole`                       | Capture console output in the log buffer.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L242)                           |
| `isAutoInstrumentEnabled`                | Check whether auto instrumentation is enabled.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L55)          |
| `isMetricsEnabled`                       | Check whether metrics collection is enabled.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L27)                         |
| `isOTLPEnabled`                          | Check whether OTLP export is enabled.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L130)                   |
| `isReservedSharedRuntimeTelemetryEnvKey` |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/telemetry-env.ts#L10)                 |
| `isTracingDegraded`                      |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L29)                         |
| `isTracingEnabled`                       | Check whether tracing is enabled.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L25)                         |
| `markRequestProfilePhase`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L203)                     |
| `parseCompileError`                      | Error shape for parse compile.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L417)                      |
| `parseMaxSize`                           | Parses max size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L46)                   |
| `profilePhase`                           |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L190)                     |
| `profileSyncPhase`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L210)                     |
| `recordApiRequest`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L306)      |
| `recordApiRetry`                         |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L321)      |
| `recordBuild`                            | Record build.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L123)                        |
| `recordBundle`                           | Record bundle.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L131)                        |
| `recordCacheGet`                         | Record cache get.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L55)                         |
| `recordCacheInvalidate`                  | Record cache invalidate.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L68)                         |
| `recordCacheSet`                         | Record cache set.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L63)                         |
| `recordContentCacheHit`                  | Record a content cache hit at the specified layer                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L343)      |
| `recordContentNetworkFetch`              | Record a content network fetch with timing                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L369)      |
| `recordCorsRejection`                    | Record CORS rejection.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L164)                        |
| `recordDataFetch`                        | Record data fetch.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L151)                        |
| `recordDataFetchError`                   | Error shape for record data fetch.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L159)                        |
| `recordErrorCount`                       |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L173)                        |
| `recordHttpRequest`                      | Request payload for record HTTP.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L42)                         |
| `recordHttpRequestComplete`              | Record HTTP request complete.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L47)                         |
| `recordRender`                           | Record render.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L81)                         |
| `recordRenderError`                      | Error shape for record render.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L89)                         |
| `recordRSCError`                         | Error shape for record rscerror.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L118)                        |
| `recordRSCRender`                        | Record RSC render.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L94)                         |
| `recordRSCRequest`                       | Request payload for record rscrequest.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L110)                        |
| `recordRSCStream`                        | Record RSC stream.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L102)                        |
| `recordSecurityHeaders`                  | Record security headers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L169)                        |
| `resetErrorCollector`                    | Reset captured runtime errors.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L411)                      |
| `resetLogBuffer`                         | Reset the in-memory log buffer.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L236)                           |
| `setActiveSpanAttributes`                | Sets active span attributes.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L467)                   |
| `setCacheSize`                           | Sets cache size.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L76)                         |
| `setSpanAttributes`                      | Sets span attributes.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L61)                         |
| `shutdownMetrics`                        | Shut down metrics collection.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L32)                         |
| `shutdownOTLP`                           | Shut down OTLP tracing export.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L124)                   |
| `shutdownTracing`                        | Shut down the tracing runtime.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L34)                         |
| `snapshotRequestProfiles`                |                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L318)                     |
| `startSpan`                              | Starts span.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L51)                         |
| `withActiveSpan`                         | Applies active span.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L102)                        |
| `withSpan`                               | Applies span.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L109)                        |
| `withSpanSync`                           | Applies span sync.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L131)                        |

### Classes

| Name                | Description                    | Source                                                                                                        |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `ErrorCollector`    | Implement error collector.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L90)      |
| `FileLogSubscriber` | Implement file log subscriber. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L173) |
| `LogBuffer`         | Implement log buffer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L37)           |

### Types

| Name                                            | Description                                                                     | Source                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ApplicationErrorContext`                       | Sanitized context attached when a runtime reports an application error.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L4)             |
| `ApplicationErrorReporter`                      | Provider-neutral application error capture and flush interface.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L26)            |
| `ApplicationErrorReporterInitializationContext` | Runtime context passed to an explicitly selected reporter initializer.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L8)  |
| `ApplicationErrorReporterInitializer`           | Application-composition contract for an error-reporting implementation.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L19) |
| `ApplicationErrorReporterLifecycle`             | Active application-error reporter ownership.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L28)                    |
| `ApplicationErrorReporterSession`               | Reporter and cleanup ownership returned by an application-selected initializer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L13) |
| `AttributeValue`                                |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L32)                      |
| `AutoInstrumentConfig`                          | Configuration used by auto instrument.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L23)                 |
| `Context`                                       |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L85)                      |
| `Counter`                                       |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L147)                     |
| `CreateOpenTelemetryServiceTracerOptions`       | Options accepted by create open telemetry service tracer.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L117)               |
| `DevError`                                      | Error shape for dev.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L32)                       |
| `ErrorFilter`                                   | Public API contract for error filter.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L58)                       |
| `ErrorSubscriber`                               | Public API contract for error subscriber.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L70)                       |
| `ErrorType`                                     | Public API contract for error type.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L14)                       |
| `FileLogConfig`                                 | Configuration used by file log.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L15)                   |
| `Histogram`                                     |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L155)                     |
| `LogBufferFilter`                               | Filter options for reading buffered log entries.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L18)                            |
| `LogEntry`                                      | Entry shape for log.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L9)                             |
| `LogLevel`                                      | Public API contract for log level.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L6)                             |
| `LogSubscriber`                                 | Public API contract for log subscriber.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L27)                            |
| `Meter`                                         |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L164)                     |
| `MetricsConfig`                                 | Configuration used by metrics.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L79)                         |
| `ModuleServeStatus`                             |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/metrics-recorder.ts#L143)      |
| `ObservableGauge`                               |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L159)                     |
| `OpenTelemetryContextApi`                       | Public API contract for open telemetry context API.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L52)                |
| `OpenTelemetryServiceTracer`                    | Public API contract for open telemetry service tracer.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L129)               |
| `OpenTelemetrySpan`                             | Public API contract for open telemetry span.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L21)                |
| `OpenTelemetrySpanContext`                      | Context for open telemetry span.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L15)                |
| `OpenTelemetryTraceApi`                         | Public API contract for open telemetry trace API.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L45)                |
| `OpenTelemetryTracer`                           | Public API contract for open telemetry tracer.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L39)                |
| `OTLPConfig`                                    | Configuration used by otlpconfig.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L45)                    |
| `RequestProfileRecord`                          |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/request-profiler.ts#L14)                      |
| `ServiceTracer`                                 | Public API contract for service tracer.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L99)                |
| `ServiceTracerAttributeInput`                   | Input payload for service tracer attribute.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L58)                |
| `ServiceTracerAttributes`                       | Public API contract for service tracer attributes.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L67)                |
| `ServiceTracerAttributeValue`                   | Public API contract for service tracer attribute value.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L61)                |
| `ServiceTracerSpan`                             | Public API contract for service tracer span.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L76)                |
| `ServiceTracerSpanContext`                      | Context for service tracer span.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L70)                |
| `ServiceTracerStartSpanOptions`                 | Options accepted by service tracer start span.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L90)                |
| `Span`                                          |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L34)                      |
| `SpanKind`                                      |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L129)                     |
| `SpanOptions`                                   | Options accepted by span.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L13)                         |
| `SpanStatusCode`                                |                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L137)                     |
| `TracingConfig`                                 | Configuration used by tracing.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L3)                          |

### Constants

| Name      | Description | Source                                                                                                        |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `metrics` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/simple-metrics/index.ts#L75) |
| `trace`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/api-shim.ts#L570)    |

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
| `addSpanEvent`             | Adds an event to a span.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L448) |
| `endServerSpan`            | End an active server tracing span.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L400) |
| `extractContext`           | Context for extract.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L331) |
| `getTraceContext`          | Context for get trace.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L499) |
| `initializeOTLP`           | Initialize OTLP tracing export.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L112) |
| `initializeOTLPWithApis`   | Initialize OTLP tracing with explicit API adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L135) |
| `injectContext`            | Context for inject.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L343) |
| `isOTLPEnabled`            | Check whether OTLP export is enabled.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L130) |
| `setActiveSpanAttributes`  | Sets active span attributes.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L467) |
| `setActiveSpanErrorStatus` | Marks the active span as failed.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L482) |
| `setSpanAttributes`        | Sets span attributes.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L432) |
| `shutdownOTLP`             | Shut down OTLP tracing export.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L124) |
| `startServerSpan`          | Starts server span.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L354) |
| `withContext`              | Context for with.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L490) |
| `withSpan`                 | Applies span.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L279) |
| `withSpanSync`             | Applies span sync.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L303) |

#### Types

| Name              | Description                       | Source                                                                                                       |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OTLPConfig`      | Configuration used by otlpconfig. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L45)  |
| `WithSpanOptions` |                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L274) |

### `veryfront/observability/sentry`

```ts
import {
  captureApplicationError,
  flushApplicationErrors,
  initializeSentry,
} from "veryfront/observability/sentry";
```

#### Functions

| Name                         | Description                                       | Source                                                                                                       |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `captureApplicationError`    |                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L265) |
| `flushApplicationErrors`     |                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-errors.ts#L293) |
| `initializeSentry`           | Initialize the process-wide Sentry reporter once. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/sentry.ts#L85)              |
| `initializeSentryFromEnv`    |                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/sentry.ts#L69)              |
| `isSentryEnabled`            | Return whether Sentry is explicitly enabled.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/sentry.ts#L38)              |
| `resetSentryForTests`        |                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/sentry.ts#L130)             |
| `resolveSentryConfigFromEnv` |                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/sentry.ts#L48)              |

#### Types

| Name                       | Description                                                             | Source                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ApplicationErrorContext`  | Sanitized context attached when a runtime reports an application error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L4)  |
| `ApplicationErrorReporter` | Provider-neutral application error capture and flush interface.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L26) |
| `SentryConfig`             |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/sentry.ts#L17)                     |
