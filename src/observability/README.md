# Observability reference

The observability module defines Veryfront's tracing, metrics, instrumentation,
request profiling, and development-diagnostics contracts.

## Public entry points

| Specifier                            | Contract                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `veryfront/observability`            | Stable tracing, metrics, instrumentation, profiling, diagnostics, and application-error contracts |
| `veryfront/observability/otlp-setup` | Lower-level shim-based tracing helpers used by framework integrations                             |

```ts
import { recordHttpRequest, withSpan } from "veryfront/observability";
```

Core uses an OpenTelemetry-compatible shim. Without an observability extension,
the shim is a no-op and traced callbacks still run. Exporter creation, provider
wiring, flushing, and resource shutdown belong to the active observability
extension and bootstrap lifecycle.

## Tracing

### Configuration

The trusted host initializes tracing from a partial `TracingConfig`:

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

`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` takes precedence over the generic
`OTEL_EXPORTER_OTLP_ENDPOINT`. Caller configuration is validated before
initialization. When an explicit runtime adapter owns environment access and
that access fails, caller configuration is preserved; core does not fall back
to a different host environment.

The core manager records configuration and binds to the active shim provider.
Exporter-specific behavior, including sampling, is implemented by the provider
extension. Concurrent initialization callers share one readiness promise.
Shutdown invalidates an in-flight initialization, so obsolete asynchronous work
cannot reinstall tracing state.

### Functions

| Function                                  | Contract                                                    |
| ----------------------------------------- | ----------------------------------------------------------- |
| `isTracingEnabled()`                      | Returns whether the manager has a tracer                    |
| `isTracingDegraded()`                     | Returns whether initialization failed                       |
| `startSpan(name, options?)`               | Returns a `Span` or `null`                                  |
| `endSpan(span, error?)`                   | Records status and ends a span; accepts `null`              |
| `setSpanAttributes(span, attributes)`     | Adds string, number, or boolean attributes                  |
| `addSpanEvent(span, name, attributes?)`   | Adds an event                                               |
| `createChildSpan(parent, name, options?)` | Creates a child span or a root span when `parent` is `null` |
| `extractContext(headers)`                 | Extracts a tracing context from headers                     |
| `injectContext(context, headers)`         | Injects an explicit context into headers                    |
| `getActiveContext()`                      | Returns the current context when available                  |
| `withActiveSpan(span, asyncFn)`           | Runs an async callback with `span` active                   |
| `withSpan(name, asyncFn, options?)`       | Runs an async callback and completes its span               |
| `withSpanSync(name, fn, options?)`        | Synchronous form of `withSpan`                              |

`SpanOptions` supports `kind`, `attributes`, and `parent`. `kind` is one of
`internal`, `server`, `client`, `producer`, or `consumer`. `parent` may be a
`Span` or a tracing `Context`.

`SpanNames` contains the framework's standard span-name constants.

## OTLP helper entry point

`veryfront/observability/otlp-setup` uses the shim provider directly. Its
`withSpan` callback receives a non-null span, which is a no-op span when no real
provider is installed.

| Function                                         | Contract                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `withSpan(name, asyncFn, attributes?, options?)` | Runs an async callback in an active span context                       |
| `withSpanSync(name, fn, attributes?, options?)`  | Runs a synchronous callback in an active span context                  |
| `startServerSpan(method, path, parentContext?)`  | Returns `{ span, context }`, or `null` when span startup fails         |
| `endServerSpan(span, statusCode, error?)`        | Records HTTP status and ends the server span                           |
| `extractContext(headers)`                        | Extracts from incoming headers                                         |
| `injectContext(headers)`                         | Injects the active context into outgoing headers                       |
| `withContext(context, asyncFn)`                  | Runs a callback in an explicit context                                 |
| `getTraceContext()`                              | Returns active `traceId` and `spanId`, or `{}`                         |
| `setActiveSpanAttributes(attributes)`            | Adds attributes to the active span                                     |
| `isOTLPEnabled()`                                | Reports whether the trusted host initialized the compatibility wrapper |

`WithSpanOptions.kind` accepts the exported numeric `SpanKind` values.

## Metrics

### Configuration

The trusted host initializes metrics from a partial `MetricsConfig`:

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
The metrics-specific endpoint takes precedence over the generic endpoint.
Configuration values are type-checked; `collectInterval` must be a positive
integer within the portable JavaScript timer range.

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

Non-finite and negative measurements are normalized before recording. Active
request and cache-size state is clamped at zero. Instrument failures are
isolated from application work.

## Instrumentation wrappers

The trusted host initializes the tracing and metrics managers. Public code
applies the exported wrappers explicitly and cannot mutate process-wide
lifecycle state.

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

Initialization snapshots nested tracing and metrics configuration. Concurrent
callers share one readiness promise, and test lifecycle resets cannot be
overwritten by an obsolete initialization.

## Service tracer adapter

`createOpenTelemetryServiceTracer(options)` adapts injected OpenTelemetry trace
and context APIs to the service tracer contract. The returned object provides:

- `tracer.startSpan`, `tracer.scope`, `tracer.wrap`, and `tracer.trace`
- `setActiveSpanAttributes(attributes)`
- `getTraceContext()`

Async wrappers keep spans open until their returned promise settles while
preserving the exact returned promise or thenable object. Telemetry recording
failures do not replace completed application results or failures.

## Application error reporting

Core defines `ApplicationErrorReporterInitializer`, the active reporter
lifecycle, and the bounded capture/flush boundary. It contains no Sentry SDK,
configuration, environment-variable handling, or vendor loader. With no
explicitly composed initializer, application-error reporting is disabled.
Selected initializer and cleanup failures propagate to their lifecycle caller;
overlapping ownership transitions are serialized so a stale reporter cannot
dispose a newer one.

`captureApplicationError(error, context)` ignores expected request
cancellation. Reporter failures, invalid reporter results, and hostile error or
context values do not replace application control flow.
`flushApplicationErrors(timeoutMs?)` has a strict deadline and returns `false`
for timeout, rejection, exceptions, or an invalid timeout; it never waits for a
non-cooperative reporter after the deadline.

Reporter context is sanitized before capture. Public fields include
`boundary`, `method`, `processRole`, `requestId`, `spanId`, `traceId`,
`errorClass`, `level`, and scalar `attributes`. Tenant-authored build and
content compile failures are still captured, but Veryfront tags them with
`errorClass: "tenant-build"` and downgrades the default `level` to `"warning"`.
Sentry integrations consume that class as the `veryfront.error_class` tag.

Concrete reporters are separate extension packages. Sentry configuration and
runtime setup are documented by `@veryfront/ext-observability-sentry`.

## In-process metrics

The public `metrics` object exposes recording operations only. Root-level
convenience exports also include `recordApiRequest`, `recordApiRetry`,
`recordContentCacheHit`, and `recordContentNetworkFetch`. Process-wide metric
snapshots stay internal to trusted monitoring handlers.

## Request profiling

The root entry point exports request-scoped phase helpers:

| Function                                     | Contract                                                              |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `profilePhase(name, asyncFn)`                | Measures and accumulates an async phase in the active request profile |
| `profileSyncPhase(name, fn)`                 | Synchronous phase measurement                                         |
| `markRequestProfilePhase(name, durationMs?)` | Adds an explicit phase duration                                       |

Profiling uses async-local request state. The full internal profiler also uses
`VERYFRONT_ENABLE_PERF_PROFILING`, `VERYFRONT_ENABLE_SERVER_TIMING`, and
`VERYFRONT_DISABLE_SLOW_REQUEST_PROFILING`.
Each request retains at most 128 distinct phase names and can produce only one
final profile record.

## Development diagnostics

### `ErrorCollector`

`ErrorCollector({ maxErrors? })` retains development errors by type and category.
`maxErrors` must be a non-negative safe integer; zero keeps notifications active
without retaining entries. Query methods return detached copies. Subscriber
failures do not interrupt collection. Retained messages and stacks are limited
to 1,000 characters; file and slug metadata is also bounded.

### `LogBuffer`

`LogBuffer({ maxSize? })` retains structured log entries. `maxSize` must be a
non-negative safe integer. `query`, `tail`, `getAll`, and `toJSON` return
detached copies. `interceptConsole(buffer, source?)` returns a function that
restores the original console methods. Retained messages are limited to 1,000
characters and source names to 255 characters.

### `FileLogSubscriber`

`FileLogConfig` contains:

| Field      | Type                                                  |
| ---------- | ----------------------------------------------------- |
| `enabled`  | `boolean`                                             |
| `path`     | non-empty `string`, at most 4,096 characters          |
| `maxSize`  | positive byte count or a string such as `"10mb"`      |
| `maxFiles` | integer from 1 through 100, including the active file |
| `level`    | `"debug" \| "info" \| "warn" \| "error"`              |
| `format`   | `"json" \| "text"`                                    |

`FileLogSubscriber` serializes writes, rotates files by size, and exposes
`flush()` and `close()`. Passive subscriber callbacks report and contain write
failures; explicit `flush()` and `close()` reject when writes, durability sync,
or file closure fails. The pending-write queue retains at most 256 entries. A
full queue drops the new entry, retains a bounded failure sample, and makes the
next explicit flush or close reject rather than hiding data loss. At most 16
individual failures are retained; additional failures are represented by one
omission summary. Concurrent flush callers share the same durability attempt
and outcome. The subscriber requires the Deno file API.

## Data safety and cardinality

Telemetry attributes with credential-like keys are replaced with
`[REDACTED]`. Credentials embedded in URL userinfo or sensitive query
parameters are also removed from traced URLs, recorded errors, buffered logs,
and collected development errors. Structured log and error context is copied
and key-redacted before retention.

Core applies the following limits before retaining values or invoking a
telemetry provider:

| Surface                  | Limit                                        |
| ------------------------ | -------------------------------------------- |
| Attributes per operation | 128                                          |
| Attribute key            | 255 characters                               |
| Attribute string or item | 10,000 characters                            |
| Attribute array          | 128 items; larger arrays become `[REDACTED]` |
| Span or event name       | 1,000 characters                             |
| Structured context depth | 16 levels                                    |
| One structured container | 1,024 entries                                |
| One structured snapshot  | 4,096 visited nodes                          |
| Retained structured text | 1,000 characters                             |

Oversized or hostile structured containers fail closed to `[REDACTED]`;
ordinary accepted values are detached from caller mutation.

Exception telemetry never evaluates error-field accessors or a configured
`Error.prepareStackTrace` hook. Safe own string-valued data fields preserve a
bounded message, already-available stack, and built-in, aggregate, custom, or
framework error name. A captured platform compatibility check identifies
native errors without consulting mutable global constructors. DOMException
prototype accessors are never invoked: runtimes whose immutable brand check
recognizes DOMException report the conservative name `DOMException` and omit
its inherited message; older Node releases treat it as opaque. Older V8
releases also omit stacks because requesting even their property descriptor
materializes the lazy stack. Proxies and accessor-backed fields fail closed;
telemetry handling never changes the value thrown back to application code.

Redaction is defense in depth, not permission to attach secrets. Free-form
values that are not recognizable URLs may still contain sensitive data. Keep
attribute keys bounded and values low-cardinality. Prefer route templates,
operation kinds, and status classes over raw IDs, arbitrary paths, request
bodies, SQL statements, or user-provided text.
