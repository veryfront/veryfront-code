import type { Context, Span, SpanKind, TextMapPropagator, Tracer } from "@opentelemetry/api";

export interface TracingConfig {
  enabled: boolean;
  exporter: "jaeger" | "zipkin" | "otlp" | "console";
  endpoint?: string;
  serviceName?: string;
  sampleRate?: number;
  debug?: boolean;
}

export interface SpanOptions {
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
  attributes?: Record<string, string | number | boolean>;
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
  tracer: Tracer | null;
  api: OpenTelemetryAPI | null;
  propagator: TextMapPropagator | null;
}

export type { Context, Span, SpanKind, TextMapPropagator, Tracer };
