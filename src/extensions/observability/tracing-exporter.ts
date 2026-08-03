/**
 * Contract interface for tracing/telemetry exporters.
 *
 * Default implementation: `@veryfront/ext-observability-opentelemetry`
 *
 * @module extensions/observability/tracing-exporter
 */

/**
 * Minimal TracerProvider interface for the contract.
 * Structurally compatible with both the core shim and the real OTel SDK.
 */
export interface TracerProvider {
  getTracer(name: string, version?: string): unknown;
}

/** Data describing a single trace span. */
export interface SpanData {
  /** Unique span identifier. */
  spanId: string;
  /** Trace identifier this span belongs to. */
  traceId: string;
  /** Parent span identifier, if any. */
  parentSpanId?: string;
  /** Human-readable operation name. */
  name: string;
  /** Span kind (`client`, `server`, `internal`, `producer`, `consumer`). */
  kind: "client" | "server" | "internal" | "producer" | "consumer";
  /** Start time as a Unix timestamp in milliseconds. */
  startTime: number;
  /** End time as a Unix timestamp in milliseconds. */
  endTime: number;
  /** Key-value attributes attached to the span. */
  attributes: Record<string, string | number | boolean>;
  /** Status of the span. */
  status: { code: "ok" | "error" | "unset"; message?: string };
}

/**
 * TracingExporter contract interface.
 *
 * Implementations export collected trace spans to an observability
 * backend (e.g. Jaeger, Zipkin, OTLP collector) and expose the SDK
 * TracerProvider so the core shim can delegate to it.
 */
export interface TracingExporter {
  /**
   * Initialize the SDK provider and exporter.
   * Called during extension setup.
   */
  start(config: Record<string, unknown>): Promise<void>;

  /** Export a batch of completed spans. */
  export(spans: SpanData[]): Promise<void>;

  /** Flush pending data and release resources. */
  shutdown(): Promise<void>;

  /**
   * Return the SDK TracerProvider so the core shim can delegate to it.
   * The shim calls this after `start()` completes.
   */
  getProvider(): TracerProvider;

  /**
   * Return the OTel Metrics API so the metrics subsystem can get meters.
   * Returns `null` when metrics are not available.
   */
  getMetricsAPI(): { getMeter(name: string | undefined, version?: string): unknown } | null;

  /**
   * Return the OTel Trace API so the core shim can look up the active span
   * (for error correlation, proxy trace-id extraction, etc.). Returns `null`
   * when tracing is disabled.
   */
  getTraceAPI?(): {
    getActiveSpan(): unknown;
    getSpan(ctx: unknown): unknown;
    setSpan(ctx: unknown, span: unknown): unknown;
  } | null;

  /**
   * Return the OTel Context API so the core shim can preserve active span
   * context across async work. Returns `null` when tracing is disabled.
   */
  getContextAPI?(): {
    active(): unknown;
    with<T>(ctx: unknown, fn: () => T): T;
  } | null;

  /**
   * Return an emitter that forwards Veryfront structured log records into the
   * active telemetry backend. Returns `null` when log export is disabled.
   */
  getLogRecordEmitter?():
    | ((record: {
      timestamp?: string;
      level?: string;
      service?: string;
      message: string;
      component?: string;
      context?: Record<string, unknown>;
      error?: unknown;
      trace_id?: string;
      span_id?: string;
    }) => void)
    | null;
}
