---
title: "veryfront/observability"
description: "OpenTelemetry tracing, metrics collection, auto-instrumentation for fetch/HTTP/React, OTLP export, and structured error and log buffering."
order: 17
---

# veryfront/observability

OpenTelemetry tracing, metrics collection, auto-instrumentation for fetch/HTTP/React, OTLP export, and structured error and log buffering.

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
| `SpanNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/span-names.ts) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addSpanEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L62) |
| `createChildSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L70) |
| `createFileLogSubscriber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L183) |
| `createOpenTelemetryServiceTracer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L161) |
| `endSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L51) |
| `extractContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L78) |
| `getActiveContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L86) |
| `getErrorCollector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L341) |
| `getLogBuffer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L163) |
| `getMetricsState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L33) |
| `initAutoInstrumentation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L11) |
| `initializeOTLP` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L76) |
| `initMetrics` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L18) |
| `initTracing` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L16) |
| `injectContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L82) |
| `instrument` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L4) |
| `instrumentBatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L46) |
| `instrumentErrorHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L31) |
| `instrumentFetch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L70) |
| `instrumentHttpHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/http-instrumentation.ts#L33) |
| `instrumentReactRender` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/react-instrumentation.ts#L4) |
| `instrumentSync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/wrappers.ts#L25) |
| `interceptConsole` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L173) |
| `isAutoInstrumentEnabled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/orchestrator.ts#L39) |
| `isMetricsEnabled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L25) |
| `isOTLPEnabled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L92) |
| `isTracingEnabled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L23) |
| `parseCompileError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L351) |
| `parseMaxSize` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L25) |
| `recordBuild` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L106) |
| `recordBundle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L113) |
| `recordCacheGet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L48) |
| `recordCacheInvalidate` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L59) |
| `recordCacheSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L55) |
| `recordCorsRejection` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L131) |
| `recordDataFetch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L120) |
| `recordDataFetchError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L127) |
| `recordHttpRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L37) |
| `recordHttpRequestComplete` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L41) |
| `recordRender` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L70) |
| `recordRenderError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L77) |
| `recordRSCError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L102) |
| `recordRSCRender` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L81) |
| `recordRSCRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L95) |
| `recordRSCStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L88) |
| `recordSecurityHeaders` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L135) |
| `resetErrorCollector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L346) |
| `resetLogBuffer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L168) |
| `setCacheSize` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L66) |
| `setSpanAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L55) |
| `shutdownMetrics` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/index.ts#L29) |
| `shutdownOTLP` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L87) |
| `shutdownTracing` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L31) |
| `startSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L47) |
| `withActiveSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L90) |
| `withSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L96) |
| `withSpanSync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/index.ts#L114) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ErrorCollector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L61) |
| `FileLogSubscriber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L49) |
| `LogBuffer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L21) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AutoInstrumentConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/auto-instrument/types.ts#L22) |
| `CreateOpenTelemetryServiceTracerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L82) |
| `DevError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L23) |
| `ErrorFilter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L48) |
| `ErrorSubscriber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L59) |
| `ErrorType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/error-collector.ts#L10) |
| `FileLogConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/file-log-subscriber.ts#L2) |
| `LogBufferFilter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L11) |
| `LogEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L2) |
| `LogLevel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts) |
| `LogSubscriber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/log-buffer.ts#L19) |
| `MetricsConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/metrics/types.ts#L62) |
| `OpenTelemetryContextApi` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L25) |
| `OpenTelemetryServiceTracer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L93) |
| `OpenTelemetrySpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L5) |
| `OpenTelemetrySpanContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts) |
| `OpenTelemetryTraceApi` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L19) |
| `OpenTelemetryTracer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L14) |
| `OTLPConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L32) |
| `ServiceTracer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L65) |
| `ServiceTracerAttributeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L30) |
| `ServiceTracerAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L37) |
| `ServiceTracerAttributeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L32) |
| `ServiceTracerSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L44) |
| `ServiceTracerSpanContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L39) |
| `ServiceTracerStartSpanOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/service-tracer.ts#L57) |
| `SpanOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L11) |
| `TracingConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/types.ts#L2) |

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
| `endServerSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L197) |
| `extractContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L168) |
| `getTraceContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L242) |
| `initializeOTLP` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L76) |
| `initializeOTLPWithApis` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L96) |
| `injectContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L175) |
| `isOTLPEnabled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L92) |
| `setActiveSpanAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L229) |
| `setSpanAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L219) |
| `shutdownOTLP` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L87) |
| `startServerSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L181) |
| `withContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L238) |
| `withSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L112) |
| `withSpanSync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L141) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `OTLPConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/tracing/otlp-setup.ts#L32) |

## Related

Architecture:

- [13-observability](../../architecture/13-observability.md): Observability architecture
