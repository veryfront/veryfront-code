# NLSpec: src/observability/

## Purpose

Provides the Veryfront renderer's full observability stack: OpenTelemetry distributed tracing, OTel metrics collection, auto-instrumentation for HTTP/fetch/React, OTLP export to Grafana Cloud, simple in-process metrics counters/histograms, structured error aggregation for the dev server, and log buffering with console interception. The module is organized into six sub-modules (tracing, metrics, instruments, auto-instrument, simple-metrics) plus two standalone files (error-collector, log-buffer), each with its own barrel export. A top-level barrel re-exports the combined public API consumed by the rest of the codebase.

## Public API

### Exports (top-level barrel `observability/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `initTracing` | `(config?, adapter?) => Promise<void>` | Initialize OpenTelemetry tracing (singleton, idempotent) |
| `isTracingEnabled` | `() => boolean` | Whether tracing is initialized and has a tracer |
| `shutdownTracing` | `() => void` | Graceful tracing shutdown |
| `startSpan` | `(name, options?) => Span \| null` | Create a new span |
| `endSpan` | `(span, error?) => void` | End a span with OK or ERROR status |
| `setSpanAttributes` | `(span, attributes) => void` | Set key-value attributes on a span |
| `addSpanEvent` | `(span, name, attributes?) => void` | Record a named event on a span |
| `createChildSpan` | `(parent, name, options?) => Span \| null` | Create a child span from a parent |
| `extractContext` | `(headers) => Context \| undefined` | Extract W3C trace context from HTTP headers |
| `injectContext` | `(context, headers) => void` | Inject W3C trace context into HTTP headers |
| `getActiveContext` | `() => Context \| undefined` | Get the currently active context |
| `withActiveSpan` | `(span, fn) => Promise<T>` | Execute async function with span as active |
| `withSpan` | `(name, fn, options?) => Promise<T>` | Create span, execute async fn, auto-end |
| `withSpanSync` | `(name, fn, options?) => T` | Create span, execute sync fn, auto-end |
| `SpanNames` | `const object` | Canonical span name constants (111 entries) |
| `TracingConfig` | `type` | Tracing configuration shape |
| `SpanOptions` | `type` | Span creation options shape |
| `initMetrics` | `(config?, adapter?) => Promise<void>` | Initialize OpenTelemetry metrics (singleton, idempotent) |
| `isMetricsEnabled` | `() => boolean` | Whether metrics is initialized and has a meter |
| `shutdownMetrics` | `() => Promise<void>` | Graceful metrics shutdown |
| `getMetricsState` | `() => { initialized, cacheSize, activeRequests }` | Runtime metrics state |
| `MetricsConfig` | `type` | Metrics configuration shape |
| `recordHttpRequest` | `(attributes?) => void` | Record HTTP request start |
| `recordHttpRequestComplete` | `(durationMs, attributes?) => void` | Record HTTP request end |
| `recordCacheGet` | `(hit, attributes?) => void` | Record cache get (hit/miss) |
| `recordCacheSet` | `(attributes?) => void` | Record cache set |
| `recordCacheInvalidate` | `(count, attributes?) => void` | Record cache invalidation |
| `setCacheSize` | `(size) => void` | Set absolute cache size |
| `recordRender` | `(durationMs, attributes?) => void` | Record page render |
| `recordRenderError` | `(attributes?) => void` | Record render error |
| `recordRSCRender` | `(durationMs, attributes?) => void` | Record RSC render |
| `recordRSCStream` | `(durationMs, attributes?) => void` | Record RSC stream |
| `recordRSCRequest` | `(type, attributes?) => void` | Record RSC request by type |
| `recordRSCError` | `(attributes?) => void` | Record RSC error |
| `recordBuild` | `(durationMs, attributes?) => void` | Record build duration |
| `recordBundle` | `(sizeKb, attributes?) => void` | Record bundle size |
| `recordDataFetch` | `(durationMs, attributes?) => void` | Record data fetch |
| `recordDataFetchError` | `(attributes?) => void` | Record data fetch error |
| `recordCorsRejection` | `(attributes?) => void` | Record CORS rejection |
| `recordSecurityHeaders` | `(attributes?) => void` | Record security headers application |
| `initAutoInstrumentation` | `(config?, adapter?) => Promise<void>` | Initialize auto-instrumentation (tracing + metrics + wrappers) |
| `isAutoInstrumentEnabled` | `() => boolean` | Whether auto-instrumentation is initialized |
| `instrument` | `(fn, spanName, options?) => T` | Wrap async function with tracing |
| `instrumentSync` | `(fn, spanName, options?) => T` | Wrap sync function with tracing |
| `instrumentBatch` | `(name, items, processor, options?) => Promise<void>` | Traced batch processing |
| `instrumentFetch` | `(baseFetch?) => typeof fetch` | Create instrumented fetch (alias for createInstrumentedFetch) |
| `instrumentHttpHandler` | `(handler) => (req) => Promise<Response>` | Wrap HTTP handler with tracing |
| `instrumentReactRender` | `(renderFn, componentName) => Promise<T>` | Wrap React render with tracing + metrics |
| `instrumentErrorHandler` | `(handler, captureToSpan?) => handler` | Wrap error handler with optional span capture |
| `AutoInstrumentConfig` | `type` | Auto-instrumentation configuration shape |
| `initializeOTLP` | `() => Promise<void>` | Initialize OTLP exporter for Grafana Cloud |
| `isOTLPEnabled` | `() => boolean` | Whether OTLP is initialized with a provider |
| `shutdownOTLP` | `() => Promise<void>` | Shutdown OTLP tracer provider |
| `OTLPConfig` | `type` | OTLP configuration shape |
| `ErrorCollector` | `class` | Dev server error aggregator |
| `getErrorCollector` | `() => ErrorCollector` | Global ErrorCollector singleton |
| `resetErrorCollector` | `() => void` | Reset global ErrorCollector |
| `parseCompileError` | `(output) => Partial<DevError> \| null` | Parse TypeScript/esbuild error output |
| `DevError` | `type` | Error entry shape |
| `ErrorFilter` | `type` | Error query filter shape |
| `ErrorSubscriber` | `type` | Error subscription callback |
| `ErrorType` | `type` | Error type union |
| `LogBuffer` | `class` | Structured log buffer |
| `getLogBuffer` | `() => LogBuffer` | Global LogBuffer singleton |
| `resetLogBuffer` | `() => void` | Reset global LogBuffer |
| `interceptConsole` | `(buffer, source?) => () => void` | Intercept console.* and pipe to buffer |
| `LogEntry` | `type` | Log entry shape |
| `LogLevel` | `type` | Log level union |
| `LogBufferFilter` | `type` | Log query filter shape (aliased from LogFilter) |
| `LogSubscriber` | `type` | Log subscription callback |

### Additional sub-module exports (not re-exported at top level)

| Export | From | Used by |
|--------|------|---------|
| `recordErrorCount` | `metrics/index.ts` | `errors/middleware/cli-error-boundary.ts`, `errors/middleware/http-error-boundary.ts` |
| `isTracingDegraded` | `tracing/index.ts` | `server/handlers/monitoring/health.handler.ts` |
| `getTracingState` | `tracing/index.ts` | (internal use) |
| `tracingManager` | `tracing/index.ts` | (internal use) |
| `TracingManager` | `tracing/index.ts` | (testing) |
| `MetricsManager` | `metrics/index.ts` | (testing) |
| `MetricsRecorder` | `metrics/index.ts` | (internal use) |
| `withSpan` (OTLP variant) | `tracing/otlp-setup.ts` | ~40 external callers (cache, data, security, etc.) |
| `withSpanSync` (OTLP variant) | `tracing/otlp-setup.ts` | `agent/memory/memory.ts` |
| `extractContext` (OTLP variant) | `tracing/otlp-setup.ts` | (external callers) |
| `injectContext` (OTLP variant) | `tracing/otlp-setup.ts` | `modules/server/module-server.ts`, `platform/adapters/token/veryfront/api-client.ts` |
| `startServerSpan` | `tracing/otlp-setup.ts` | (external callers) |
| `endServerSpan` | `tracing/otlp-setup.ts` | (external callers) |
| `setSpanAttributes` (OTLP variant) | `tracing/otlp-setup.ts` | (external callers) |
| `setActiveSpanAttributes` | `tracing/otlp-setup.ts` | `agent/composition/composition.ts`, `agent/runtime/ai-stream-handler.ts`, `agent/middleware/rate-limit/limiter.ts`, `agent/middleware/cache/cache.ts` |
| `withContext` | `tracing/otlp-setup.ts` | (external callers) |
| `getTraceContext` | `tracing/otlp-setup.ts` | (external callers) |
| `initializeOTLPWithApis` | `tracing/otlp-setup.ts` | `proxy/tracing.ts`, `server/production-server.ts`, `proxy/main.ts` |
| `metrics` (namespace object) | `simple-metrics/index.ts` | (external callers) |
| `recordError` | `instruments/error-instruments.ts` | (external callers) |
| `initializeInstruments` | `instruments/index.ts` | `metrics/manager.ts` |
| Various simple-metrics exports | `simple-metrics/index.ts` | `platform/adapters/fs/veryfront/content-metrics.ts` |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `@opentelemetry/api` | npm (esm.sh) | Core OTel API (Tracer, Meter, Span, Context, propagation) |
| `@opentelemetry/core` | npm (esm.sh) | W3CTraceContextPropagator |
| `@opentelemetry/sdk-trace-base` | npm (esm.sh) | BasicTracerProvider, BatchSpanProcessor |
| `@opentelemetry/exporter-trace-otlp-http` | npm (esm.sh) | OTLPTraceExporter |
| `@opentelemetry/resources` | npm (esm.sh) | Resource (service metadata) |
| `@opentelemetry/semantic-conventions` | npm (esm.sh) | ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION |
| `@opentelemetry/context-async-hooks` | npm (esm.sh) | AsyncLocalStorageContextManager |
| `#veryfront/utils` | internal | serverLogger |
| `#veryfront/utils/version.ts` | internal | VERSION constant |
| `#veryfront/config/env.ts` | internal | getOtelTracingConfig, getOtelMetricsConfig |
| `#veryfront/config/defaults.ts` | internal | DURATION_HISTOGRAM_BOUNDARIES_MS, SIZE_HISTOGRAM_BOUNDARIES_KB |
| `#veryfront/platform/adapters/base.ts` | internal | RuntimeAdapter type |
| `#veryfront/platform/compat/process.ts` | internal | memoryUsage |
| `#veryfront/platform/compat/runtime.ts` | internal | isDeno flag |
| `#veryfront/errors/types.ts` | internal | ErrorCategory, VeryfrontError types |
| `#veryfront/errors/error-registry.ts` | internal | Error registry entries (tests only) |

## Behaviors

### Behavior 1: Tracing initialization (TracingManager)
- **Given**: TracingManager is not yet initialized
- **When**: `initTracing({ enabled: true })` is called
- **Then**: OpenTelemetry API is dynamically imported, a Tracer is created, W3CTraceContextPropagator is set as global, SpanOperations and ContextPropagation helpers are instantiated
- **Edge cases**: If `enabled: false`, marks as initialized but creates no tracer. If already initialized, silently skips. If OTel import fails, enters degraded mode.

### Behavior 2: Span lifecycle
- **Given**: Tracing is initialized and enabled
- **When**: `startSpan("name", { kind: "server", attributes: {...} })` is called
- **Then**: Returns a Span object with the given name, mapped SpanKind, and attributes
- **When**: `endSpan(span, error?)` is called
- **Then**: Records exception if error provided, sets status (OK or ERROR), calls `span.end()`
- **Edge cases**: All span operations accept null spans and no-op gracefully. If underlying OTel API throws, errors are caught and logged at debug level.

### Behavior 3: Context propagation
- **Given**: Tracing is initialized
- **When**: `extractContext(headers)` is called with incoming HTTP headers
- **Then**: W3C trace context is extracted from the carrier and returned as a Context
- **When**: `injectContext(context, headers)` is called
- **Then**: Trace context is serialized and set on the outgoing Headers
- **Edge cases**: Returns undefined on extraction failure. Silently no-ops on injection failure.

### Behavior 4: Metrics initialization (MetricsManager)
- **Given**: MetricsManager is not yet initialized
- **When**: `initMetrics({ enabled: true })` is called
- **Then**: OpenTelemetry API is dynamically imported, a Meter is created, all instrument factories are invoked (HTTP, cache, render, RSC, build, data, memory, error), and MetricsRecorder is wired up
- **Edge cases**: If `enabled: false`, marks as initialized but creates no meter. If already initialized, silently skips. If instrument creation fails, logs warning and continues with null instruments.

### Behavior 5: Metrics recording
- **Given**: MetricsRecorder has instruments (possibly null)
- **When**: Any `record*` function is called
- **Then**: The corresponding OTel counter/histogram is incremented, and RuntimeState (cacheSize, activeRequests) is updated
- **Edge cases**: All recording methods use optional chaining (`instrument?.add(...)`) so null instruments are silently skipped.

### Behavior 6: Auto-instrumentation orchestrator
- **Given**: Auto-instrumentation is not initialized
- **When**: `initAutoInstrumentation(config)` is called
- **Then**: Config is merged with defaults (all features enabled), tracing and metrics are initialized if their sub-configs have `enabled: true`, initialization state is set
- **Edge cases**: If either init fails, catches error and logs warning, still marks as initialized.

### Behavior 7: HTTP handler instrumentation
- **Given**: An HTTP handler function `(Request) => Response`
- **When**: `instrumentHttpHandler(handler)` wraps it
- **Then**: Returns a new handler that extracts parent context from request headers, creates a SERVER span, records HTTP attributes (method, URL, host, scheme), invokes the original handler, records response status/duration, ends the span
- **Edge cases**: If span creation fails, falls back to calling the raw handler. Non-Error throws are recorded as exceptions.

### Behavior 8: Fetch instrumentation
- **Given**: A base fetch function
- **When**: `createInstrumentedFetch(baseFetch)` wraps it
- **Then**: Returns a new fetch that creates CLIENT spans, injects trace context into outgoing headers, records HTTP attributes and response status/duration
- **Edge cases**: Handles string, URL, and Request inputs. Falls back to base fetch if span creation fails. Relative URLs are handled gracefully.

### Behavior 9: React render instrumentation
- **Given**: A render function and component name
- **When**: `instrumentReactRender(renderFn, componentName)` is called
- **Then**: Creates a span via withSpan, measures render duration, records render error metrics on failure
- **Edge cases**: Handles both sync and async render functions.

### Behavior 10: OTLP setup (production tracing)
- **Given**: OTEL_TRACES_ENABLED=true and OTEL_EXPORTER_OTLP_ENDPOINT set
- **When**: `initializeOTLP()` is called
- **Then**: BasicTracerProvider is created with Resource, BatchSpanProcessor with OTLPTraceExporter, AsyncLocalStorageContextManager is enabled, provider is registered globally, trace-bridge logger is imported
- **Edge cases**: Idempotent. If endpoint missing, skips. If any import fails, marks as initialized to prevent retries.

### Behavior 11: ErrorCollector
- **Given**: An ErrorCollector instance
- **When**: Errors are added via `add()`, `addCompileError()`, `addRuntimeError()`, etc.
- **Then**: Error is stored with auto-generated ID and timestamp, subscribers are notified, max capacity is enforced by evicting oldest
- **Edge cases**: Validates that error type matches expected category (throws on mismatch). Subscriber errors are silently caught. Filters support type, category, slug, file (string or regex), and since timestamp.

### Behavior 12: LogBuffer
- **Given**: A LogBuffer instance
- **When**: Log entries are appended via `debug()`, `info()`, `warn()`, `error()`
- **Then**: Entry is stored with auto-generated ID and timestamp, oldest entries are evicted when maxSize exceeded, subscribers are notified
- **Edge cases**: Query supports filtering by level, source, pattern (string or regex), since timestamp, and limit. Format method outputs timestamped, level-padded, source-padded lines.

### Behavior 13: Console interception
- **Given**: A LogBuffer instance
- **When**: `interceptConsole(buffer, source)` is called
- **Then**: console.log/info/warn/error/debug are replaced with wrappers that pipe to the buffer AND call the original method. Returns a restore function.
- **Edge cases**: Non-string arguments are JSON.stringify'd with circular reference fallback to String().

### Behavior 14: Simple metrics (in-process counters)
- **Given**: The simple-metrics state singleton
- **When**: Recording functions (`incRequest`, `recordSSR`, `recordCacheGet`, etc.) are called
- **Then**: In-memory counters are incremented, OTel instruments are updated (if initialized), and the observability-metrics bridge is called via lazy loading
- **Edge cases**: All OTel operations are wrapped in `safeOtelOperation` which catches and logs errors. Histogram bucket placement uses `findIndex` with overflow to last bucket.

## Constraints
- All OpenTelemetry dependencies are dynamically imported to avoid hard failures when OTel is unavailable
- Initialization is idempotent across all managers (tracing, metrics, auto-instrument, OTLP)
- All span operations gracefully handle null spans (no-op)
- All metric recording operations gracefully handle null instruments (no-op via optional chaining)
- Environment variable configuration supports both RuntimeAdapter.env.get() and direct Deno.env access

## Error Handling
- Tracing initialization failures enter "degraded mode" (initialized=true, tracer=null)
- Metrics initialization failures are logged as warnings and continue with null instruments
- Individual span/metric operations catch and log errors at debug level, never propagate
- ErrorCollector subscriber errors are silently caught
- LogBuffer subscriber errors are silently caught
- OTLP initialization failures mark as initialized to prevent retry loops

## Side Effects
- `initializeOTLP()` sets a global OTel propagator and registers a tracer provider
- `interceptConsole()` replaces global console methods
- Module-level singletons: `tracingManager`, `metricsManager`, `globalCollector`, `globalBuffer`, `otel` instruments object, OTLP module-level state
- `initializeOTLP()` imports `#veryfront/utils/logger/trace-bridge.ts` as side effect to wire trace context into logger

## Performance Constraints
- All recording operations are designed to be non-blocking and low-overhead
- OTel instruments are lazily initialized
- The observability loader caches its import promise to avoid repeated dynamic imports
- Batch instrumentation processes items in configurable batch sizes (default 10)
- Memory metrics poll via ObservableGauge callbacks, not active timers

## Invariants
- Once initialized, managers cannot be re-initialized (idempotent guard)
- ErrorCollector.add() enforces type-to-category mapping consistency
- SpanNames values are unique, non-empty, lowercase dot-notation strings
- Cache size in RuntimeState never goes below zero
- LogBuffer entries are ordered chronologically
- ErrorCollector errors are stored in insertion order (Map iteration order)
