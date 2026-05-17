---
title: "veryfront/observability"
description: "OpenTelemetry tracing, metrics collection, auto-instrumentation for fetch/HTTP/React, OTLP export, and structured error and log buffering."
order: 17
---

# veryfront/observability

OpenTelemetry tracing, metrics collection, auto-instrumentation for fetch/HTTP/React, OTLP export, and structured error and log buffering.

## Examples

```ts
import { withSpan } from "veryfront/observability";

const result = await withSpan("load-data", async () => {
  return await fetch("https://example.com/data");
});
```

## API groups

| Group                 | Exports                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracing               | `initTracing()`, `shutdownTracing()`, `startSpan()`, `endSpan()`, `withSpan()`, `withSpanSync()`, `withActiveSpan()`, `createChildSpan()`, `addSpanEvent()`, `setSpanAttributes()`, `injectContext()`, `extractContext()`, `getActiveContext()`, `isTracingEnabled()`, `SpanNames`                                                                    |
| Metrics               | `initMetrics()`, `shutdownMetrics()`, `isMetricsEnabled()`, `getMetricsState()`, `recordHttpRequest()`, `recordHttpRequestComplete()`, `recordRender()`, `recordRenderError()`, `recordBuild()`, `recordBundle()`, `recordDataFetch()`, `recordDataFetchError()`, `recordCacheGet()`, `recordCacheSet()`, `recordCacheInvalidate()`, `setCacheSize()` |
| Auto-instrumentation  | `initAutoInstrumentation()`, `instrument()`, `instrumentSync()`, `instrumentBatch()`, `instrumentFetch()`, `instrumentHttpHandler()`, `instrumentReactRender()`, `instrumentErrorHandler()`, `isAutoInstrumentEnabled()`                                                                                                                              |
| OTLP                  | `initializeOTLP()`, `shutdownOTLP()`, `isOTLPEnabled()`                                                                                                                                                                                                                                                                                               |
| Service tracing       | `createOpenTelemetryServiceTracer()` and the `ServiceTracer` type family.                                                                                                                                                                                                                                                                             |
| Error and log buffers | `ErrorCollector`, `getErrorCollector()`, `resetErrorCollector()`, `parseCompileError()`, `LogBuffer`, `getLogBuffer()`, `resetLogBuffer()`, `interceptConsole()`                                                                                                                                                                                      |
| File logging          | `FileLogSubscriber`, `createFileLogSubscriber()`, `parseMaxSize()`                                                                                                                                                                                                                                                                                    |

Use the lower-level functions when the host owns the server shell and needs to
initialize or shut down telemetry explicitly. Framework entrypoints can use the
higher-level configuration paths documented in
[`Configuration`](../guides/configuration.md).
