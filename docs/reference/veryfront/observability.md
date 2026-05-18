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

| Name | Description |
|------|-------------|
| `SpanNames` |  |

### Functions

| Name | Description |
|------|-------------|
| `addSpanEvent` |  |
| `createChildSpan` |  |
| `createFileLogSubscriber` |  |
| `createOpenTelemetryServiceTracer` |  |
| `endSpan` |  |
| `extractContext` |  |
| `getActiveContext` |  |
| `getErrorCollector` |  |
| `getLogBuffer` |  |
| `getMetricsState` |  |
| `initAutoInstrumentation` |  |
| `initializeOTLP` |  |
| `initMetrics` |  |
| `initTracing` |  |
| `injectContext` |  |
| `instrument` |  |
| `instrumentBatch` |  |
| `instrumentErrorHandler` |  |
| `instrumentFetch` |  |
| `instrumentHttpHandler` |  |
| `instrumentReactRender` |  |
| `instrumentSync` |  |
| `interceptConsole` |  |
| `isAutoInstrumentEnabled` |  |
| `isMetricsEnabled` |  |
| `isOTLPEnabled` |  |
| `isTracingEnabled` |  |
| `parseCompileError` |  |
| `parseMaxSize` |  |
| `recordBuild` |  |
| `recordBundle` |  |
| `recordCacheGet` |  |
| `recordCacheInvalidate` |  |
| `recordCacheSet` |  |
| `recordCorsRejection` |  |
| `recordDataFetch` |  |
| `recordDataFetchError` |  |
| `recordHttpRequest` |  |
| `recordHttpRequestComplete` |  |
| `recordRender` |  |
| `recordRenderError` |  |
| `recordRSCError` |  |
| `recordRSCRender` |  |
| `recordRSCRequest` |  |
| `recordRSCStream` |  |
| `recordSecurityHeaders` |  |
| `resetErrorCollector` |  |
| `resetLogBuffer` |  |
| `setCacheSize` |  |
| `setSpanAttributes` |  |
| `shutdownMetrics` |  |
| `shutdownOTLP` |  |
| `shutdownTracing` |  |
| `startSpan` |  |
| `withActiveSpan` |  |
| `withSpan` |  |
| `withSpanSync` |  |

### Classes

| Name | Description |
|------|-------------|
| `ErrorCollector` |  |
| `FileLogSubscriber` |  |
| `LogBuffer` |  |

### Types

| Name | Description |
|------|-------------|
| `AutoInstrumentConfig` |  |
| `CreateOpenTelemetryServiceTracerOptions` |  |
| `DevError` |  |
| `ErrorFilter` |  |
| `ErrorSubscriber` |  |
| `ErrorType` |  |
| `FileLogConfig` |  |
| `LogBufferFilter` |  |
| `LogEntry` |  |
| `LogLevel` |  |
| `LogSubscriber` |  |
| `MetricsConfig` |  |
| `OpenTelemetryContextApi` |  |
| `OpenTelemetryServiceTracer` |  |
| `OpenTelemetrySpan` |  |
| `OpenTelemetrySpanContext` |  |
| `OpenTelemetryTraceApi` |  |
| `OpenTelemetryTracer` |  |
| `OTLPConfig` |  |
| `ServiceTracer` |  |
| `ServiceTracerAttributeInput` |  |
| `ServiceTracerAttributes` |  |
| `ServiceTracerAttributeValue` |  |
| `ServiceTracerSpan` |  |
| `ServiceTracerSpanContext` |  |
| `ServiceTracerStartSpanOptions` |  |
| `SpanOptions` |  |
| `TracingConfig` |  |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/observability/otlp-setup`

*********************** OpenTelemetry OTLP Setup Thin wrapper that delegates to the `ext-observability-opentelemetry` extension via the `TracingExporter` contract. When the extension is not installed, all span operations silently no-op. Reads configuration from environment variables: - OTEL_TRACES_ENABLED: "true" to enable tracing - OTEL_SERVICE_NAME: Service name for traces - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint - OTEL_EXPORTER_OTLP_HEADERS: Auth headers ************************

```ts
import { endServerSpan, extractContext, getTraceContext } from "veryfront/observability/otlp-setup";
```

#### Functions

| Name | Description |
|------|-------------|
| `endServerSpan` |  |
| `extractContext` |  |
| `getTraceContext` |  |
| `initializeOTLP` |  |
| `initializeOTLPWithApis` |  |
| `injectContext` |  |
| `isOTLPEnabled` |  |
| `setActiveSpanAttributes` |  |
| `setSpanAttributes` |  |
| `shutdownOTLP` |  |
| `startServerSpan` |  |
| `withContext` |  |
| `withSpan` |  |
| `withSpanSync` |  |

#### Types

| Name | Description |
|------|-------------|
| `OTLPConfig` |  |

## Related

Architecture:

- [17-observability](../../architecture/17-observability.md): Observability architecture
