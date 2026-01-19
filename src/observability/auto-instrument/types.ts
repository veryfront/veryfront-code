import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export interface TracingConfig {
  enabled: boolean;
  exporter?: "jaeger" | "zipkin" | "otlp" | "console";
  endpoint?: string;
  serviceName?: string;
}

export interface MetricsConfig {
  enabled: boolean;
  exporter?: "prometheus" | "otlp" | "console";
  endpoint?: string;
  prefix?: string;
}

export interface AutoInstrumentConfig {
  tracing?: TracingConfig;
  metrics?: MetricsConfig;
  instrumentHttp?: boolean;
  instrumentFetch?: boolean;
  instrumentReact?: boolean;
  captureErrors?: boolean;
}

export interface InstrumentationContext {
  config: AutoInstrumentConfig;
  adapter?: RuntimeAdapter;
  initialized: boolean;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export interface InstrumentOptions {
  attributes?: (args: unknown[]) => SpanAttributes;
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
}

export interface BatchOptions {
  batchSize?: number;
  attributes?: SpanAttributes;
}

export type ErrorAttributes = Record<string, string | number | boolean>;

export type HttpAttributes = Record<string, string | number | boolean>;
