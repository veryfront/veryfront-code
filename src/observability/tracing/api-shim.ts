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

import { runSyncWithContextFallback } from "./context-callback.ts";

// ---------------------------------------------------------------------------
// Tracing types
// ---------------------------------------------------------------------------

// OTel SDK types `AttributeValue | undefined` on setAttribute/setAttributes so
// indexed lookups into partial attribute records don't require null-filtering
// at every call site. Mirror that loose typing here so callers match the SDK.
export type AttributePrimitive = string | number | boolean;
export type AttributeValue = AttributePrimitive | readonly AttributePrimitive[] | undefined;

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

export interface ContextAccessor {
  active(): Context;
  with<T>(ctx: Context, fn: () => T): T;
}

export interface ActiveSpanAccessor {
  getActiveSpan(): Span | undefined;
  getSpan(ctx: Context): Span | undefined;
  setSpan?(ctx: Context, span: Span): Context;
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
  removeCallback?(callback: (result: ObservableResult) => void): void;
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

function createNoopContext(
  entries: ReadonlyMap<symbol, unknown> = new Map(),
): Context {
  const store = new Map(entries);
  return Object.freeze({
    getValue: (key: symbol) => store.get(key),
    setValue(key: symbol, value: unknown) {
      const next = new Map(store);
      next.set(key, value);
      return createNoopContext(next);
    },
    deleteValue(key: symbol) {
      const next = new Map(store);
      next.delete(key);
      return createNoopContext(next);
    },
  });
}

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

const ACTIVE_SPAN_CONTEXT_KEY = Symbol.for("veryfront.observability.active_span");

/** Complete provider facade installed into the process-wide telemetry shim. */
export interface GlobalTelemetryAPIConfig {
  tracerProvider?: TracerProvider | null;
  metricsApi?: MetricsAPI | null;
  contextAccessor?: ContextAccessor | null;
  activeSpanAccessor?: ActiveSpanAccessor | null;
  propagator?: TextMapPropagator | null;
}

/** Opaque ownership identity for one installed telemetry generation. */
export interface GlobalTelemetryAPIOwner {
  readonly generation: number;
  readonly token: symbol;
}

/** Handle returned by an atomic telemetry API installation. */
export interface GlobalTelemetryAPIInstallation extends GlobalTelemetryAPIOwner {
  /** Clear this generation if it is still current. Stale handles return false. */
  dispose(): boolean;
}

/** Immutable point-in-time view of the currently installed telemetry facade. */
export interface GlobalTelemetryAPISnapshot {
  readonly generation: number;
  readonly tracerProviderRevision: number;
  readonly metricsApiRevision: number;
  readonly tracerProviderInstalled: boolean;
  readonly tracerProvider: TracerProvider;
  readonly metricsApi: MetricsAPI | null;
  readonly contextAccessor: ContextAccessor | null;
  readonly activeSpanAccessor: ActiveSpanAccessor | null;
  readonly propagator: TextMapPropagator | null;
}

interface GlobalTelemetryAPIState extends GlobalTelemetryAPISnapshot {
  readonly ownerToken: symbol;
}

function createEmptyTelemetryState(
  generation = 0,
  tracerProviderRevision = 0,
  metricsApiRevision = 0,
): GlobalTelemetryAPIState {
  return Object.freeze({
    generation,
    tracerProviderRevision,
    metricsApiRevision,
    tracerProviderInstalled: false,
    tracerProvider: createNoopProvider(),
    metricsApi: null,
    contextAccessor: null,
    activeSpanAccessor: null,
    propagator: null,
    ownerToken: Symbol("veryfront.telemetry.empty"),
  });
}

let telemetryState = createEmptyTelemetryState();
let _activeContext: Context = createNoopContext();

function resetFallbackContext(): void {
  _activeContext = createNoopContext();
}

function activateFallbackContext(ctx: Context): () => void {
  const generation = telemetryState.generation;
  const previous = _activeContext;
  _activeContext = ctx;
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    if (generation !== telemetryState.generation) return;
    if (_activeContext === ctx) _activeContext = previous;
  };
}

function assertOptionalMethod(
  value: object | null | undefined,
  method: string,
  label: string,
): void {
  if (value === null || value === undefined) return;
  if (typeof (value as Record<string, unknown>)[method] !== "function") {
    throw new TypeError(`${label} must implement ${method}()`);
  }
}

function preReadTelemetryConfig(config: GlobalTelemetryAPIConfig): {
  tracerProvider: TracerProvider;
  tracerProviderInstalled: boolean;
  metricsApi: MetricsAPI | null;
  contextAccessor: ContextAccessor | null;
  activeSpanAccessor: ActiveSpanAccessor | null;
  propagator: TextMapPropagator | null;
} {
  // Read every potentially accessor-backed property before mutating global
  // state. A hostile or partially constructed facade therefore cannot leave
  // the shim half-installed.
  const suppliedTracerProvider = config.tracerProvider;
  const metricsApi = config.metricsApi ?? null;
  const contextAccessor = config.contextAccessor ?? null;
  const activeSpanAccessor = config.activeSpanAccessor ?? null;
  const propagator = config.propagator ?? null;

  assertOptionalMethod(suppliedTracerProvider, "getTracer", "tracerProvider");
  assertOptionalMethod(metricsApi, "getMeter", "metricsApi");
  assertOptionalMethod(contextAccessor, "active", "contextAccessor");
  assertOptionalMethod(contextAccessor, "with", "contextAccessor");
  assertOptionalMethod(activeSpanAccessor, "getActiveSpan", "activeSpanAccessor");
  assertOptionalMethod(activeSpanAccessor, "getSpan", "activeSpanAccessor");
  assertOptionalMethod(propagator, "inject", "propagator");
  assertOptionalMethod(propagator, "extract", "propagator");

  return {
    tracerProvider: suppliedTracerProvider ?? createNoopProvider(),
    tracerProviderInstalled: suppliedTracerProvider !== null &&
      suppliedTracerProvider !== undefined,
    metricsApi,
    contextAccessor,
    activeSpanAccessor,
    propagator,
  };
}

function installTelemetryState(
  config: ReturnType<typeof preReadTelemetryConfig>,
): GlobalTelemetryAPIInstallation {
  const previous = telemetryState;
  const generation = previous.generation + 1;
  const token = Symbol(`veryfront.telemetry.${generation}`);
  telemetryState = Object.freeze({
    generation,
    tracerProviderRevision: previous.tracerProviderRevision + 1,
    metricsApiRevision: previous.metricsApiRevision + 1,
    ...config,
    ownerToken: token,
  });
  resetFallbackContext();

  return Object.freeze({
    generation,
    token,
    dispose: () => clearGlobalTelemetryAPI({ generation, token }),
  });
}

/** Atomically install one complete telemetry facade and return its owner handle. */
export function installGlobalTelemetryAPI(
  config: GlobalTelemetryAPIConfig,
): GlobalTelemetryAPIInstallation {
  return installTelemetryState(preReadTelemetryConfig(config));
}

/** Clear the current generation without allowing stale owners to clobber it. */
export function clearGlobalTelemetryAPI(owner: GlobalTelemetryAPIOwner): boolean {
  const current = telemetryState;
  if (owner.generation !== current.generation || owner.token !== current.ownerToken) {
    return false;
  }

  telemetryState = createEmptyTelemetryState(
    current.generation + 1,
    current.tracerProviderRevision + 1,
    current.metricsApiRevision + 1,
  );
  resetFallbackContext();
  return true;
}

/** Read one internally consistent telemetry facade snapshot. */
export function getGlobalTelemetryAPISnapshot(): GlobalTelemetryAPISnapshot {
  const current = telemetryState;
  return Object.freeze({
    generation: current.generation,
    tracerProviderRevision: current.tracerProviderRevision,
    metricsApiRevision: current.metricsApiRevision,
    tracerProviderInstalled: current.tracerProviderInstalled,
    tracerProvider: current.tracerProvider,
    metricsApi: current.metricsApi,
    contextAccessor: current.contextAccessor,
    activeSpanAccessor: current.activeSpanAccessor,
    propagator: current.propagator,
  });
}

function updateTelemetryState(
  patch: Partial<
    Pick<
      GlobalTelemetryAPIState,
      | "tracerProvider"
      | "tracerProviderInstalled"
      | "metricsApi"
      | "contextAccessor"
      | "activeSpanAccessor"
      | "propagator"
    >
  >,
  revisions: { tracer?: boolean; metrics?: boolean } = {},
): void {
  const current = telemetryState;
  telemetryState = Object.freeze({
    ...current,
    ...patch,
    generation: current.generation + 1,
    tracerProviderRevision: current.tracerProviderRevision + (revisions.tracer ? 1 : 0),
    metricsApiRevision: current.metricsApiRevision + (revisions.metrics ? 1 : 0),
    ownerToken: Symbol("veryfront.telemetry.legacy-install"),
  });
  resetFallbackContext();
}

/**
 * Register the real OTel trace API's span accessors. Called by the
 * ext-observability-opentelemetry extension after it wires the SDK so that the shim's
 * `trace.getActiveSpan()` / `trace.getSpan()` can return real spans.
 */
export function setGlobalActiveSpanAccessor(
  accessor: ActiveSpanAccessor,
): void {
  updateTelemetryState({ activeSpanAccessor: accessor });
}

/**
 * Register the real OTel context API. This lets the shim preserve active span
 * context across async boundaries once the extension has installed the SDK's
 * AsyncLocalStorageContextManager.
 */
export function setGlobalContextAccessor(accessor: ContextAccessor): void {
  updateTelemetryState({ contextAccessor: accessor });
}

/**
 * Wire in the real SDK TracerProvider.
 * Called from `src/server/bootstrap.ts` after `orchestrateExtensions()` runs.
 */
export function setGlobalTracerProvider(p: TracerProvider): void {
  updateTelemetryState({ tracerProvider: p, tracerProviderInstalled: true }, { tracer: true });
}

export function getGlobalTracerProvider(): TracerProvider {
  return telemetryState.tracerProvider;
}

export function getTracerProviderRevision(): number {
  return telemetryState.tracerProviderRevision;
}

/**
 * Get a tracer from the active provider.
 * Returns the no-op tracer when ext-observability-opentelemetry is not installed.
 */
export function getTracer(name: string, version?: string): Tracer {
  return telemetryState.tracerProvider.getTracer(name, version);
}

// ---------------------------------------------------------------------------
// Context API
// ---------------------------------------------------------------------------

export const context = {
  active(): Context {
    try {
      return telemetryState.contextAccessor?.active() ?? _activeContext;
    } catch (_) {
      return _activeContext;
    }
  },
  with<T>(ctx: Context, fn: () => T): T {
    const accessor = telemetryState.contextAccessor;
    if (accessor) {
      return runSyncWithContextFallback(
        (callback) => accessor.with(ctx, callback),
        fn,
      );
    }

    const restore = activateFallbackContext(ctx);
    try {
      return fn();
    } finally {
      // A process-global fallback cannot preserve context across awaits without
      // cross-contaminating concurrent work. Real async propagation is supplied
      // by the installed context accessor; the fallback is synchronous only.
      restore();
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
    return telemetryState.tracerProvider.getTracer(name, version);
  },
  setGlobalTracerProvider(p: TracerProvider): void {
    setGlobalTracerProvider(p);
  },
  getGlobalTracerProvider(): TracerProvider {
    return telemetryState.tracerProvider;
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
    try {
      const accessor = telemetryState.activeSpanAccessor;
      if (accessor?.setSpan) return accessor.setSpan(ctx, _span);
      return ctx.setValue(ACTIVE_SPAN_CONTEXT_KEY, _span);
    } catch (_) {
      return ctx;
    }
  },
  getSpan(ctx: Context): Span | undefined {
    try {
      return telemetryState.activeSpanAccessor?.getSpan(ctx) ??
        (ctx.getValue(ACTIVE_SPAN_CONTEXT_KEY) as Span | undefined);
    } catch (_) {
      return undefined;
    }
  },
  getActiveSpan(): Span | undefined {
    try {
      return telemetryState.activeSpanAccessor?.getActiveSpan() ?? trace.getSpan(context.active());
    } catch (_) {
      return undefined;
    }
  },
};

// ---------------------------------------------------------------------------
// Propagation API
// ---------------------------------------------------------------------------

export const propagation = {
  setGlobalPropagator(p: TextMapPropagator): void {
    updateTelemetryState({ propagator: p });
  },
  extract<C>(ctx: Context, carrier: C, getter?: TextMapGetter<C>): Context {
    const propagator = telemetryState.propagator;
    if (!propagator) return ctx;
    return propagator.extract(ctx, carrier, getter as TextMapGetter<unknown> | undefined);
  },
  inject<C>(ctx: Context, carrier: C, setter?: TextMapSetter<C>): void {
    const propagator = telemetryState.propagator;
    if (!propagator) return;
    propagator.inject(ctx, carrier, setter as TextMapSetter<unknown> | undefined);
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

/**
 * Register the OTel Metrics API (from the SDK).
 * Called by ext-observability-opentelemetry in its setup hook so the metrics subsystem
 * can use `getMeter()` when available.
 */
export function setGlobalMetricsAPI(api: MetricsAPI): void {
  updateTelemetryState({ metricsApi: api }, { metrics: true });
}

export function getGlobalMetricsAPI(): MetricsAPI | null {
  return telemetryState.metricsApi;
}

/** Monotonic revision used by lazy instruments to detect provider changes. */
export function getMetricsApiRevision(): number {
  return telemetryState.metricsApiRevision;
}

// ---------------------------------------------------------------------------
// Reset for tests
// ---------------------------------------------------------------------------

export function _resetShimForTests(): void {
  const current = telemetryState;
  telemetryState = createEmptyTelemetryState(
    current.generation + 1,
    current.tracerProviderRevision + 1,
    current.metricsApiRevision + 1,
  );
  resetFallbackContext();
}
