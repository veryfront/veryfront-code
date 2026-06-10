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
 * not backed by a live SDK — the metrics subsystem is wired separately):
 *   `Meter`, `Counter`, `Histogram`, `ObservableGauge`, `UpDownCounter`,
 *   `ObservableResult`
 *
 * @module observability/tracing/api-shim
 */

// ---------------------------------------------------------------------------
// Tracing types
// ---------------------------------------------------------------------------

// OTel SDK types `AttributeValue | undefined` on setAttribute/setAttributes so
// indexed lookups into partial attribute records don't require null-filtering
// at every call site. Mirror that loose typing here so callers match the SDK.
export type AttributeValue = string | number | boolean | undefined;

export interface Span {
  setAttribute(key: string, value: AttributeValue): Span;
  setAttributes(attrs: Record<string, AttributeValue>): Span;
  setStatus(status: { code: number; message?: string }): Span;
  recordException(err: unknown): void;
  addEvent(name: string, attrs?: Record<string, AttributeValue>): Span;
  end(endTime?: number): void;
  spanContext(): SpanContext;
  updateName(name: string): void;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface Tracer {
  startSpan(
    name: string,
    options?: {
      kind?: number;
      attributes?: Record<string, AttributeValue>;
    },
    context?: Context,
  ): Span;
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

export interface TracerProvider {
  getTracer(name: string, version?: string): Tracer;
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface Context {
  getValue(key: symbol): unknown;
  setValue(key: symbol, value: unknown): Context;
  deleteValue(key: symbol): Context;
}

export interface TextMapGetter<C = Record<string, string>> {
  keys(carrier: C): string[];
  get(carrier: C, key: string): string | string[] | undefined;
}

export interface TextMapSetter<C = Record<string, string>> {
  set(carrier: C, key: string, value: string): void;
}

export interface TextMapPropagator {
  inject(context: Context, carrier: unknown, setter?: TextMapSetter<unknown>): void;
  extract(context: Context, carrier: unknown, getter?: TextMapGetter<unknown>): Context;
  fields(): string[];
}

// ---------------------------------------------------------------------------
// Span kind + status constants
// ---------------------------------------------------------------------------

export const SpanKind = {
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
} as const;

export type SpanKind = typeof SpanKind[keyof typeof SpanKind];

export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

export type SpanStatusCode = typeof SpanStatusCode[keyof typeof SpanStatusCode];

// ---------------------------------------------------------------------------
// Metrics types (structural; not backed by a live SDK here)
// ---------------------------------------------------------------------------

export interface ObservableResult {
  observe(value: number, attributes?: Record<string, AttributeValue>): void;
}

export interface Counter {
  add(value: number, attributes?: Record<string, AttributeValue>): void;
}

export interface UpDownCounter {
  add(value: number, attributes?: Record<string, AttributeValue>): void;
}

export interface Histogram {
  record(value: number, attributes?: Record<string, AttributeValue>): void;
}

export interface ObservableGauge {
  addCallback(callback: (result: ObservableResult) => void): void;
}

export interface Meter {
  createCounter(name: string, options?: { description?: string; unit?: string }): Counter;
  createUpDownCounter(
    name: string,
    options?: { description?: string; unit?: string },
  ): UpDownCounter;
  createHistogram(
    name: string,
    options?: {
      description?: string;
      unit?: string;
      advice?: { explicitBucketBoundaries?: number[] };
    },
  ): Histogram;
  createObservableGauge(
    name: string,
    options?: { description?: string; unit?: string },
  ): ObservableGauge;
  getMeter?: never; // Prevents accidental use of Meter as MetricsAPI
}

export interface MetricsAPI {
  getMeter(name: string | undefined, version?: string): Meter;
}

// ---------------------------------------------------------------------------
// No-op provider (default when ext-observability-opentelemetry is not installed)
// ---------------------------------------------------------------------------

function createNoopContext(): Context {
  return {
    getValue: () => undefined,
    setValue(_key, _value) {
      return this;
    },
    deleteValue(_key) {
      return this;
    },
  };
}

const NOOP_CONTEXT: Context = createNoopContext();

const NOOP_SPAN_CONTEXT: SpanContext = {
  traceId: "00000000000000000000000000000000",
  spanId: "0000000000000000",
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
let _activeContext: Context = NOOP_CONTEXT;
let _propagator: TextMapPropagator | null = null;

/**
 * Optional accessor for the currently active span. Wired by
 * ext-observability-opentelemetry (via `setGlobalActiveSpanAccessor`) so `trace.getActiveSpan()`
 * and `trace.getSpan()` return the real SDK span once the extension is active.
 */
let _activeSpanAccessor: {
  getActiveSpan(): Span | undefined;
  getSpan(ctx: Context): Span | undefined;
} | null = null;

/**
 * Register the real OTel trace API's span accessors. Called by the
 * ext-observability-opentelemetry extension after it wires the SDK so that the shim's
 * `trace.getActiveSpan()` / `trace.getSpan()` can return real spans.
 */
export function setGlobalActiveSpanAccessor(
  accessor: { getActiveSpan(): Span | undefined; getSpan(ctx: Context): Span | undefined },
): void {
  _activeSpanAccessor = accessor;
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
    return _activeContext;
  },
  with<T>(ctx: Context, fn: () => T): T {
    const prev = _activeContext;
    _activeContext = ctx;
    try {
      return fn();
    } finally {
      _activeContext = prev;
    }
  },
  setGlobalContextManager(_mgr: unknown): void {
    // no-op in shim; real SDK sets this via the real OTel API
  },
};

// ---------------------------------------------------------------------------
// Trace API (simplified subset used by core)
// ---------------------------------------------------------------------------

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
    return ctx;
  },
  getSpan(ctx: Context): Span | undefined {
    return _activeSpanAccessor?.getSpan(ctx);
  },
  getActiveSpan(): Span | undefined {
    return _activeSpanAccessor?.getActiveSpan();
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
    carrier[key] = value;
  },
};

// ---------------------------------------------------------------------------
// Metrics API registry (injected by ext-observability-opentelemetry when active)
// ---------------------------------------------------------------------------

let _metricsApi: MetricsAPI | null = null;

/**
 * Register the OTel Metrics API (from the SDK).
 * Called by ext-observability-opentelemetry in its setup hook so the metrics subsystem
 * can use `getMeter()` when available.
 */
export function setGlobalMetricsAPI(api: MetricsAPI): void {
  _metricsApi = api;
}

export function getGlobalMetricsAPI(): MetricsAPI | null {
  return _metricsApi;
}

// ---------------------------------------------------------------------------
// Reset for tests
// ---------------------------------------------------------------------------

export function _resetShimForTests(): void {
  _provider = createNoopProvider();
  _providerRevision++;
  _activeContext = NOOP_CONTEXT;
  _propagator = null;
  _metricsApi = null;
  _activeSpanAccessor = null;
}
