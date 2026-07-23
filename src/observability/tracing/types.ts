import type { Context, Span, SpanKind, TextMapPropagator, Tracer } from "./api-shim.ts";

/** Configuration used by tracing. */
export interface TracingConfig {
  /** Whether tracing is enabled. */
  enabled: boolean;
  /** Trace exporter selected for this runtime. */
  exporter: "jaeger" | "zipkin" | "otlp" | "console";
  /** Optional exporter endpoint. */
  endpoint?: string;
  /** Service name attached to emitted spans. */
  serviceName?: string;
  /** Fraction of traces sampled, from `0` through `1`. */
  sampleRate?: number;
  /** Whether diagnostic telemetry logging is enabled. */
  debug?: boolean;
}

/** Options accepted by span. */
export interface SpanOptions {
  /** OpenTelemetry kind assigned to the new span. */
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
  /** Bounded, code-owned attributes attached at span creation. */
  attributes?: Record<string, string | number | boolean>;
  /** Optional parent span or context. */
  parent?: Span | Context;
}

export interface OpenTelemetryAPI {
  trace: {
    getTracer(name: string | undefined, version?: string): Tracer;
    setSpan(context: Context, span: Span): Context;
  };
  propagation: {
    setGlobalPropagator(propagator: TextMapPropagator): void;
    extract(context: Context, carrier: Record<string, string>): Context;
    inject(context: Context, carrier: Record<string, string>): void;
  };
  context: {
    active(): Context;
    with<T>(context: Context, fn: () => T): T;
  };
  SpanKind: typeof SpanKind;
  SpanStatusCode: {
    OK: number;
    ERROR: number;
  };
}

export interface TracingState {
  initialized: boolean;
  degraded: boolean;
  tracer: Tracer | null;
  api: OpenTelemetryAPI | null;
  propagator: TextMapPropagator | null;
}

export type { Context, Span, SpanKind, TextMapPropagator, Tracer };
