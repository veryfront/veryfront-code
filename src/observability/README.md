# Observability reference

The observability module defines Veryfront's tracing, metrics, instrumentation,
request profiling, and development-diagnostics contracts.

## Public entry points

| Specifier                            | Contract                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `veryfront/observability`            | Stable public tracing, metrics, instrumentation, profiling, and diagnostics API |
| `veryfront/observability/otlp-setup` | Lower-level shim-based tracing helpers used by framework integrations           |

```ts
import { initTracing, recordHttpRequest, withSpan } from "veryfront/observability";
```

Core uses an OpenTelemetry-compatible shim. Without an observability extension,
the shim is a no-op and traced callbacks still run. Exporter creation, provider
wiring, flushing, and resource shutdown belong to the active observability
extension and bootstrap lifecycle.

## Tracing

### Configuration

`initTracing(config?, adapter?)` accepts a partial `TracingConfig`:

| Field         | Type                                          | Default       |
| ------------- | --------------------------------------------- | ------------- |
| `enabled`     | `boolean`                                     | `false`       |
| `exporter`    | `"jaeger" \| "zipkin" \| "otlp" \| "console"` | `"console"`   |
| `endpoint`    | `string`                                      | unset         |
| `serviceName` | `string`                                      | `"veryfront"` |
| `sampleRate`  | `number`                                      | `1`           |
| `debug`       | `boolean`                                     | `false`       |

The runtime adapter or host environment can provide:

- `VERYFRONT_OTEL=1`
- `OTEL_TRACES_ENABLED=true`
- `OTEL_SERVICE_NAME`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_TRACES_EXPORTER`

The core manager records configuration and binds to the active shim provider.
Exporter-specific behavior, including sampling, is implemented by the provider
extension.

### Functions

| Function                                  | Contract                                                         |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `initTracing(config?, adapter?)`          | Initializes the core tracing manager once                        |
| `isTracingEnabled()`                      | Returns whether the manager has a tracer                         |
| `isTracingDegraded()`                     | Returns whether initialization failed                            |
| `shutdownTracing()`                       | Signals core shutdown; exporter teardown remains extension-owned |
| `startSpan(name, options?)`               | Returns a `Span` or `null`                                       |
| `endSpan(span, error?)`                   | Records status and ends a span; accepts `null`                   |
| `setSpanAttributes(span, attributes)`     | Adds string, number, or boolean attributes                       |
| `addSpanEvent(span, name, attributes?)`   | Adds an event                                                    |
| `createChildSpan(parent, name, options?)` | Creates a child span or a root span when `parent` is `null`      |
| `extractContext(headers)`                 | Extracts a tracing context from headers                          |
| `injectContext(context, headers)`         | Injects an explicit context into headers                         |
| `getActiveContext()`                      | Returns the current context when available                       |
| `withActiveSpan(span, asyncFn)`           | Runs an async callback with `span` active                        |
| `withSpan(name, asyncFn, options?)`       | Runs an async callback and completes its span                    |
| `withSpanSync(name, fn, options?)`        | Synchronous form of `withSpan`                                   |

`SpanOptions` supports `kind`, `attributes`, and `parent`. `kind` is one of
`internal`, `server`, `client`, `producer`, or `consumer`. `parent` may be a
`Span` or a tracing `Context`.

`SpanNames` contains the framework's standard span-name constants.

## OTLP helper entry point

`veryfront/observability/otlp-setup` uses the shim provider directly. Its
`withSpan` callback receives a non-null span, which is a no-op span when no real
provider is installed.

| Function                                         | Contract                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `withSpan(name, asyncFn, attributes?, options?)` | Runs an async callback in an active span context                      |
| `withSpanSync(name, fn, attributes?, options?)`  | Runs a synchronous callback in an active span context                 |
| `startServerSpan(method, path, parentContext?)`  | Returns `{ span, context }`, or `null` when span startup fails        |
| `endServerSpan(span, statusCode, error?)`        | Records HTTP status and ends the server span                          |
| `extractContext(headers)`                        | Extracts from incoming headers                                        |
| `injectContext(headers)`                         | Injects the active context into outgoing headers                      |
| `withContext(context, asyncFn)`                  | Runs a callback in an explicit context                                |
| `getTraceContext()`                              | Returns active `traceId` and `spanId`, or `{}`                        |
| `setActiveSpanAttributes(attributes)`            | Adds attributes to the active span                                    |
| `initializeOTLP()`                               | Marks the compatibility wrapper initialized                           |
| `shutdownOTLP()`                                 | Delegates shutdown to the extension lifecycle                         |
| `isOTLPEnabled()`                                | Reports whether `initializeOTLP()` was called, not exporter readiness |

`WithSpanOptions.kind` accepts the exported numeric `SpanKind` values.

## Metrics

### Configuration

`initMetrics(config?, adapter?)` accepts a partial `MetricsConfig`:

| Field             | Type                                  | Default              |
| ----------------- | ------------------------------------- | -------------------- |
| `enabled`         | `boolean`                             | `false`              |
| `exporter`        | `"prometheus" \| "otlp" \| "console"` | `"console"`          |
| `endpoint`        | `string`                              | unset                |
| `prefix`          | `string`                              | `"veryfront"`        |
| `collectInterval` | `number`                              | `60000` milliseconds |
| `debug`           | `boolean`                             | `false`              |

The runtime adapter or host environment can provide `VERYFRONT_OTEL`,
`OTEL_METRICS_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, and `OTEL_METRICS_EXPORTER`.

The core metrics manager requires a metrics API installed by an observability
extension. Without one, recorders update their in-process runtime state and
external instruments remain disabled.

### Functions

All duration arguments are milliseconds. Attributes are
`Record<string, string>`.

| Function                                                                                   | Signature summary                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `recordHttpRequest`                                                                        | `(attributes?) => void`                                               |
| `recordHttpRequestComplete`                                                                | `(durationMs, attributes?) => void`                                   |
| `recordCacheGet`                                                                           | `(hit, attributes?) => void`                                          |
| `recordCacheSet`                                                                           | `(attributes?) => void`                                               |
| `recordCacheInvalidate`                                                                    | `(count, attributes?) => void`                                        |
| `setCacheSize`                                                                             | `(size) => void`                                                      |
| `recordRender`, `recordRSCRender`, `recordRSCStream`                                       | `(durationMs, attributes?) => void`                                   |
| `recordRenderError`, `recordRSCError`                                                      | `(attributes?) => void`                                               |
| `recordRSCRequest`                                                                         | `("manifest" \| "page" \| "stream" \| "action", attributes?) => void` |
| `recordBuild`, `recordDataFetch`                                                           | `(durationMs, attributes?) => void`                                   |
| `recordBundle`                                                                             | `(sizeKb, attributes?) => void`                                       |
| `recordDataFetchError`, `recordCorsRejection`, `recordSecurityHeaders`, `recordErrorCount` | `(attributes?) => void`                                               |
| `getMetricsState()`                                                                        | Returns initialization, cache-size, and active-request state          |
| `isMetricsEnabled()`                                                                       | Returns whether a real meter is installed                             |
| `shutdownMetrics()`                                                                        | Signals core shutdown; exporter teardown remains extension-owned      |

Non-finite and negative measurements are normalized before recording. Active
request and cache-size state is clamped at zero. Instrument failures are
isolated from application work.

## Instrumentation wrappers

`initAutoInstrumentation(config?, adapter?)` initializes the configured tracing
and metrics managers. It does not replace global functions. Apply the exported
wrappers explicitly.

`AutoInstrumentConfig` contains optional `tracing`, `metrics`,
`instrumentHttp`, `instrumentFetch`, `instrumentReact`, and `captureErrors`
fields. The four instrumentation flags are configuration metadata; wrapper
installation remains explicit.

| Function                                            | Contract                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `instrumentHttpHandler(handler)`                    | Returns an async request handler with server-span tracing                  |
| `instrumentFetch(baseFetch?)`                       | Returns a fetch-compatible function; it does not mutate `globalThis.fetch` |
| `instrumentReactRender(renderFn, componentName)`    | Traces one synchronous or asynchronous render                              |
| `instrumentErrorHandler(handler, captureToSpan?)`   | Optionally captures an error before invoking the handler                   |
| `instrument(fn, spanName, options?)`                | Wraps an async function and preserves its argument/result types            |
| `instrumentSync(fn, spanName, options?)`            | Synchronous form of `instrument`                                           |
| `instrumentBatch(name, items, processor, options?)` | Processes sequential batches, with items in each batch run concurrently    |
| `isAutoInstrumentEnabled()`                         | Reports whether the initializer has completed                              |

`instrumentBatch` defaults to a batch size of 10 and rejects non-positive or
non-integer batch sizes.

## Service tracer adapter

`createOpenTelemetryServiceTracer(options)` adapts injected OpenTelemetry trace
and context APIs to the service tracer contract. The returned object provides:

- `tracer.startSpan`, `tracer.scope`, `tracer.wrap`, and `tracer.trace`
- `setActiveSpanAttributes(attributes)`
- `getTraceContext()`

Async wrappers keep spans open until their returned promise settles while
preserving the exact returned promise or thenable object. Telemetry recording
failures do not replace completed application results or failures.

## In-process metrics

The `metrics` object exposes counters and bounded histogram snapshots for
framework-local diagnostics. Root-level convenience exports also include
`recordApiRequest`, `recordApiRetry`, `recordContentCacheHit`, and
`recordContentNetworkFetch`.

`metrics.snapshot()` returns a detached snapshot. Histogram boundaries and
counts in returned snapshots are safe for callers to mutate.

## Request profiling

The root entry point exports:

| Function                                     | Contract                                                              |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `profilePhase(name, asyncFn)`                | Measures and accumulates an async phase in the active request profile |
| `profileSyncPhase(name, fn)`                 | Synchronous phase measurement                                         |
| `markRequestProfilePhase(name, durationMs?)` | Adds an explicit phase duration                                       |
| `snapshotRequestProfiles()`                  | Returns retained profile records and the latest sequence              |

Profiling uses async-local request state. The full internal profiler also uses
`VERYFRONT_ENABLE_PERF_PROFILING`, `VERYFRONT_ENABLE_SERVER_TIMING`, and
`VERYFRONT_DISABLE_SLOW_REQUEST_PROFILING`.

## Development diagnostics

### `ErrorCollector`

`ErrorCollector({ maxErrors? })` retains development errors by type and category.
`maxErrors` must be a non-negative safe integer; zero keeps notifications active
without retaining entries. Query methods return detached copies. Subscriber
failures do not interrupt collection.

### `LogBuffer`

`LogBuffer({ maxSize? })` retains structured log entries. `maxSize` must be a
non-negative safe integer. `query`, `tail`, `getAll`, and `toJSON` return
detached copies. `interceptConsole(buffer, source?)` returns a function that
restores the original console methods.

### `FileLogSubscriber`

`FileLogConfig` contains:

| Field      | Type                                             |
| ---------- | ------------------------------------------------ |
| `enabled`  | `boolean`                                        |
| `path`     | non-empty `string`                               |
| `maxSize`  | positive byte count or a string such as `"10mb"` |
| `maxFiles` | positive safe integer                            |
| `level`    | `"debug" \| "info" \| "warn" \| "error"`         |
| `format`   | `"json" \| "text"`                               |

`FileLogSubscriber` serializes writes, rotates files by size, and exposes
`flush()` and `close()`. Passive subscriber callbacks report and contain write
failures; explicit `flush()` and `close()` reject when writes, durability sync,
or file closure fails. It requires the Deno file API.

## Data safety and cardinality

Telemetry attributes with credential-like keys are replaced with
`[REDACTED]`. Credentials embedded in URL userinfo or sensitive query
parameters are also removed from traced URLs, recorded errors, buffered logs,
and collected development errors. Structured log and error context is copied
and key-redacted before retention.

Redaction is defense in depth, not permission to attach secrets. Free-form
values that are not recognizable URLs may still contain sensitive data. Keep
attribute keys bounded and values low-cardinality. Prefer route templates,
operation kinds, and status classes over raw IDs, arbitrary paths, request
bodies, SQL statements, or user-provided text.
