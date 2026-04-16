/**
 * Contract interface for tracing/telemetry exporters.
 *
 * Default implementation: `@veryfront/ext-opentelemetry`
 *
 * @module extensions/interfaces/tracing-exporter
 */

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
 * backend (e.g. Jaeger, Zipkin, OTLP collector).
 */
export interface TracingExporter {
  /** Export a batch of completed spans. */
  export(spans: SpanData[]): Promise<void>;
  /** Flush pending data and release resources. */
  shutdown(): Promise<void>;
}
