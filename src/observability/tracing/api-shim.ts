/**
 * Thin in-process shim for `@opentelemetry/api`.
 *
 * Core files that previously imported directly from `@opentelemetry/api` now
 * import from this module.  When the `ext-observability-opentelemetry` extension is present
 * the real SDK provider is wired in via `setGlobalTracerProvider`; otherwise
 * every call falls back to a no-op implementation so the core boots without the
 * extension installed.
 *
 * **Tracing types and constants** (exported for call-site use):
 *   `Span`, `Tracer`, `TracerProvider`, `Context`, `TextMapPropagator`
 *   `SpanKind`, `SpanStatusCode`
 *
 * **Metrics types** (re-exported structural shapes for the metrics subsystem;
 * not backed by a live SDK. The metrics subsystem is wired separately):
 *   `Meter`, `Counter`, `Histogram`, `ObservableGauge`, `UpDownCounter`,
 *   `ObservableResult`
 *
 * @module observability/tracing/api-shim
 */

import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// Tracing types
// ---------------------------------------------------------------------------

// OTel SDK types `AttributeValue | undefined` on setAttribute/setAttributes so
// indexed lookups into partial attribute records don't require null-filtering
// at every call site. Mirror that loose typing here so callers match the SDK.
/** Scalar value accepted by OpenTelemetry attributes. */
export type AttributePrimitive = string | number | boolean;

/** Value accepted by OpenTelemetry attributes. */
export type AttributeValue = AttributePrimitive | readonly AttributePrimitive[] | undefined;

/** Minimal span contract used by the Veryfront runtime. */
export interface Span {
  /** Set one attribute and return this span. */
  setAttribute(key: string, value: AttributeValue): Span;
  /** Set multiple attributes and return this span. */
  setAttributes(attrs: Record<string, AttributeValue>): Span;
  /** Set the span status. */
  setStatus(status: { code: number; message?: string }): Span;
  /** Record a sanitized exception on the span. */
  recordException(err: unknown): void;
  /** Add an event to the span. */
  addEvent(name: string, attrs?: Record<string, AttributeValue>): Span;
  /** End the span at an optional timestamp. */
  end(endTime?: number): void;
  /** Return this span's propagation identifiers. */
  spanContext(): SpanContext;
  /** Replace the span name. */
  updateName(name: string): void;
}

/** Propagation identifiers associated with a span. */
export interface SpanContext {
  /** Lowercase 32-character hexadecimal trace identifier. */
  traceId: string;
  /** Lowercase 16-character hexadecimal span identifier. */
  spanId: string;
  /** W3C trace flags. */
  traceFlags: number;
}

/** Minimal tracer contract used by the Veryfront runtime. */
export interface Tracer {
  /** Start a span without activating it. */
  startSpan(
    name: string,
    options?: {
      kind?: number;
      attributes?: Record<string, AttributeValue>;
    },
    context?: Context,
  ): Span;
  /** Start a span and invoke a callback while it is active. */
  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T,
  ): T;
  startActiveSpan<T>(
    name: string,
    options: { kind?: number; attributes?: Record<string, AttributeValue> },
    fn: (span: Span) => T,
  ): T;
  startActiveSpan<T>(
    name: string,
    options: { kind?: number; attributes?: Record<string, AttributeValue> },
    context: Context,
    fn: (span: Span) => T,
  ): T;
}

/** Provider that creates named tracers. */
export interface TracerProvider {
  /** Return a tracer for an instrumentation scope. */
  getTracer(name: string, version?: string): Tracer;
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

/** Immutable key-value context propagated across asynchronous work. */
export interface Context {
  /** Read a value from the context. */
  getValue(key: symbol): unknown;
  /** Return a context with a value set. */
  setValue(key: symbol, value: unknown): Context;
  /** Return a context without a value. */
  deleteValue(key: symbol): Context;
}

/** Accessor used to read values from a propagation carrier. */
export interface TextMapGetter<C = Record<string, string>> {
  /** Return the available carrier keys. */
  keys(carrier: C): string[];
  /** Read a propagation value from the carrier. */
  get(carrier: C, key: string): string | string[] | undefined;
}

/** Accessor used to write values to a propagation carrier. */
export interface TextMapSetter<C = Record<string, string>> {
  /** Write a propagation value to the carrier. */
  set(carrier: C, key: string, value: string): void;
}

/** Propagator for extracting and injecting distributed trace context. */
export interface TextMapPropagator {
  /** Inject context into a carrier. */
  inject(context: Context, carrier: unknown, setter?: TextMapSetter<unknown>): void;
  /** Extract context from a carrier. */
  extract(context: Context, carrier: unknown, getter?: TextMapGetter<unknown>): Context;
  /** Return the carrier fields written by this propagator. */
  fields(): string[];
}

/** Runtime accessor for the active context. */
export interface ContextAccessor {
  /** Return the active context. */
  active(): Context;
  /** Invoke a callback with a context active. */
  with<T>(ctx: Context, fn: () => T): T;
}

/** Runtime accessor for active spans. */
export interface ActiveSpanAccessor {
  /** Return the currently active span. */
  getActiveSpan(): Span | undefined;
  /** Return the span stored in a context. */
  getSpan(ctx: Context): Span | undefined;
  /** Return a context containing a span. */
  setSpan?(ctx: Context, span: Span): Context;
}

// ---------------------------------------------------------------------------
// Span kind + status constants
// ---------------------------------------------------------------------------

/** Numeric OpenTelemetry span-kind constants. */
export const SpanKind = {
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
} as const;

/** OpenTelemetry span-kind value. */
export type SpanKind = typeof SpanKind[keyof typeof SpanKind];

/** Numeric OpenTelemetry span-status constants. */
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

/** OpenTelemetry span-status value. */
export type SpanStatusCode = typeof SpanStatusCode[keyof typeof SpanStatusCode];

// ---------------------------------------------------------------------------
// Metrics types (structural; not backed by a live SDK here)
// ---------------------------------------------------------------------------

/** Callback result used to report observable measurements. */
export interface ObservableResult {
  /** Observe one measurement with optional attributes. */
  observe(value: number, attributes?: Record<string, AttributeValue>): void;
}

/** Monotonic counter instrument. */
export interface Counter {
  /** Add a non-negative value to the counter. */
  add(value: number, attributes?: Record<string, AttributeValue>): void;
}

/** Counter instrument that accepts positive and negative changes. */
export interface UpDownCounter {
  /** Add a value to the counter. */
  add(value: number, attributes?: Record<string, AttributeValue>): void;
}

/** Histogram instrument. */
export interface Histogram {
  /** Record one measurement. */
  record(value: number, attributes?: Record<string, AttributeValue>): void;
}

/** Observable gauge instrument. */
export interface ObservableGauge {
  /** Register a callback that reports gauge measurements. */
  addCallback(callback: (result: ObservableResult) => void): void;
}

/** Factory for metric instruments in one instrumentation scope. */
export interface Meter {
  /** Create a monotonic counter. */
  createCounter(name: string, options?: { description?: string; unit?: string }): Counter;
  /** Create a counter that accepts positive and negative changes. */
  createUpDownCounter(
    name: string,
    options?: { description?: string; unit?: string },
  ): UpDownCounter;
  /** Create a histogram. */
  createHistogram(
    name: string,
    options?: {
      description?: string;
      unit?: string;
      advice?: { explicitBucketBoundaries?: number[] };
    },
  ): Histogram;
  /** Create an observable gauge. */
  createObservableGauge(
    name: string,
    options?: { description?: string; unit?: string },
  ): ObservableGauge;
  /** Marker that prevents a meter from being used as the metrics API registry. */
  getMeter?: never; // Prevents accidental use of Meter as MetricsAPI
}

/** Registry that creates named metric meters. */
export interface MetricsAPI {
  /** Return a meter for an instrumentation scope. */
  getMeter(name: string | undefined, version?: string): Meter;
}

// ---------------------------------------------------------------------------
// No-op provider (default when ext-observability-opentelemetry is not installed)
// ---------------------------------------------------------------------------

function createNoopContext(values: ReadonlyMap<symbol, unknown> = new Map()): Context {
  return {
    getValue: (key) => values.get(key),
    setValue(key, value) {
      const next = new Map(values);
      next.set(key, value);
      return createNoopContext(next);
    },
    deleteValue(key) {
      if (!values.has(key)) return this;
      const next = new Map(values);
      next.delete(key);
      return createNoopContext(next);
    },
  };
}

const NOOP_CONTEXT: Context = createNoopContext();
const EMPTY_TRACE_ID = "00000000000000000000000000000000";
const EMPTY_SPAN_ID = "0000000000000000";

const NOOP_SPAN_CONTEXT: SpanContext = {
  traceId: EMPTY_TRACE_ID,
  spanId: EMPTY_SPAN_ID,
  traceFlags: 0,
};

const NOOP_SPAN: Span = {
  setAttribute() {
    return NOOP_SPAN;
  },
  setAttributes() {
    return NOOP_SPAN;
  },
  setStatus() {
    return NOOP_SPAN;
  },
  recordException() {},
  addEvent() {
    return NOOP_SPAN;
  },
  end() {},
  spanContext() {
    return NOOP_SPAN_CONTEXT;
  },
  updateName() {},
};

function createNoopTracer(): Tracer {
  return {
    startSpan(): Span {
      return NOOP_SPAN;
    },
    startActiveSpan<T>(
      _name: string,
      optionsOrFn:
        | { kind?: number; attributes?: Record<string, AttributeValue> }
        | ((span: Span) => T),
      contextOrFn?: Context | ((span: Span) => T),
      fn?: (span: Span) => T,
    ): T {
      const callback = typeof optionsOrFn === "function"
        ? optionsOrFn
        : typeof contextOrFn === "function"
        ? contextOrFn
        : fn!;
      return callback(NOOP_SPAN);
    },
  };
}

function createNoopProvider(): TracerProvider {
  const noopTracer = createNoopTracer();
  return { getTracer: () => noopTracer };
}

// ---------------------------------------------------------------------------
// Global provider state
// ---------------------------------------------------------------------------

let _provider: TracerProvider = createNoopProvider();
let _providerRevision = 0;
const fallbackContextStorage = new AsyncLocalStorage<Context>();
let _propagator: TextMapPropagator | null = null;
let _contextAccessor: ContextAccessor | null = null;
const ACTIVE_SPAN_CONTEXT_KEY = Symbol.for("veryfront.observability.active_span");

/**
 * Optional accessor for the currently active span. Wired by
 * ext-observability-opentelemetry (via `setGlobalActiveSpanAccessor`) so `trace.getActiveSpan()`
 * and `trace.getSpan()` return the real SDK span once the extension is active.
 */
let _activeSpanAccessor: ActiveSpanAccessor | null = null;

/**
 * Register the real OTel trace API's span accessors. Called by the
 * ext-observability-opentelemetry extension after it wires the SDK so that the shim's
 * `trace.getActiveSpan()` / `trace.getSpan()` can return real spans.
 */
export function setGlobalActiveSpanAccessor(
  accessor: ActiveSpanAccessor,
): void {
  _activeSpanAccessor = accessor;
}

/**
 * Register the real OTel context API. This lets the shim preserve active span
 * context across async boundaries once the extension has installed the SDK's
 * AsyncLocalStorageContextManager.
 */
export function setGlobalContextAccessor(accessor: ContextAccessor): void {
  _contextAccessor = accessor;
}

/**
 * Wire in the real SDK TracerProvider.
 * Called from `src/server/bootstrap.ts` after `orchestrateExtensions()` runs.
 */
export function setGlobalTracerProvider(p: TracerProvider): void {
  _provider = p;
  _providerRevision++;
}

export function getGlobalTracerProvider(): TracerProvider {
  return _provider;
}

export function getTracerProviderRevision(): number {
  return _providerRevision;
}

/**
 * Get a tracer from the active provider.
 * Returns the no-op tracer when ext-observability-opentelemetry is not installed.
 */
export function getTracer(name: string, version?: string): Tracer {
  return _provider.getTracer(name, version);
}

// ---------------------------------------------------------------------------
// Context API
// ---------------------------------------------------------------------------

export const context = {
  active(): Context {
    return _contextAccessor?.active() ?? fallbackContextStorage.getStore() ?? NOOP_CONTEXT;
  },
  with<T>(ctx: Context, fn: () => T): T {
    if (_contextAccessor) {
      return _contextAccessor.with(ctx, fn);
    }
    return fallbackContextStorage.run(ctx, fn);
  },
  setGlobalContextManager(_mgr: unknown): void {
    // no-op in shim; real SDK sets this via the real OTel API
  },
};

// ---------------------------------------------------------------------------
// Trace API (simplified subset used by core)
// ---------------------------------------------------------------------------

/** Minimal global trace API backed by the registered provider. */
export const trace = {
  getTracer(name: string, version?: string): Tracer {
    return _provider.getTracer(name, version);
  },
  setGlobalTracerProvider(p: TracerProvider): void {
    _provider = p;
    _providerRevision++;
  },
  getGlobalTracerProvider(): TracerProvider {
    return _provider;
  },
  setSpan(ctx: Context, _span: Span): Context {
    try {
      const spanContext = _span.spanContext();
      if (spanContext.traceId === EMPTY_TRACE_ID || spanContext.spanId === EMPTY_SPAN_ID) {
        return ctx;
      }
    } catch {
      // Keep structural test doubles usable even when they omit spanContext().
    }
    if (_activeSpanAccessor?.setSpan) {
      return _activeSpanAccessor.setSpan(ctx, _span);
    }
    return ctx.setValue(ACTIVE_SPAN_CONTEXT_KEY, _span);
  },
  getSpan(ctx: Context): Span | undefined {
    return _activeSpanAccessor?.getSpan(ctx) ??
      (ctx.getValue(ACTIVE_SPAN_CONTEXT_KEY) as Span | undefined);
  },
  getActiveSpan(): Span | undefined {
    return _activeSpanAccessor?.getActiveSpan() ?? trace.getSpan(context.active());
  },
};

// ---------------------------------------------------------------------------
// Propagation API
// ---------------------------------------------------------------------------

export const propagation = {
  setGlobalPropagator(p: TextMapPropagator): void {
    _propagator = p;
  },
  extract<C>(ctx: Context, carrier: C, getter?: TextMapGetter<C>): Context {
    if (!_propagator) return ctx;
    return _propagator.extract(ctx, carrier, getter as TextMapGetter<unknown> | undefined);
  },
  inject<C>(ctx: Context, carrier: C, setter?: TextMapSetter<C>): void {
    if (!_propagator) return;
    _propagator.inject(ctx, carrier, setter as TextMapSetter<unknown> | undefined);
  },
};

// ---------------------------------------------------------------------------
// defaultTextMapGetter / defaultTextMapSetter (used by proxy/tracing.ts)
// ---------------------------------------------------------------------------

export const defaultTextMapGetter: TextMapGetter<Record<string, string>> = {
  keys(carrier) {
    return Object.keys(carrier);
  },
  get(carrier, key) {
    return carrier[key];
  },
};

export const defaultTextMapSetter: TextMapSetter<Record<string, string>> = {
  set(carrier, key, value) {
    Object.defineProperty(carrier, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  },
};

// ---------------------------------------------------------------------------
// Metrics API registry (injected by ext-observability-opentelemetry when active)
// ---------------------------------------------------------------------------

let _metricsApi: MetricsAPI | null = null;
let _metricsApiRevision = 0;

/**
 * Register the OTel Metrics API (from the SDK).
 * Called by ext-observability-opentelemetry in its setup hook so the metrics subsystem
 * can use `getMeter()` when available.
 */
export function setGlobalMetricsAPI(api: MetricsAPI): void {
  _metricsApi = api;
  _metricsApiRevision++;
}

/** Return the metrics API registered by the observability extension. */
export function getGlobalMetricsAPI(): MetricsAPI | null {
  return _metricsApi;
}

/** Return a monotonic revision for consumers that cache metric instruments. */
export function getGlobalMetricsAPIRevision(): number {
  return _metricsApiRevision;
}

// ---------------------------------------------------------------------------
// Reset for tests
// ---------------------------------------------------------------------------

export function _resetShimForTests(): void {
  _provider = createNoopProvider();
  _providerRevision++;
  fallbackContextStorage.disable();
  _propagator = null;
  _contextAccessor = null;
  _metricsApi = null;
  _metricsApiRevision++;
  _activeSpanAccessor = null;
}
