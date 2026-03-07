import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

type AttributeValue = string | number | boolean;

type SpanAttributes = Record<string, AttributeValue>;
export type ErrorAttributes = Record<string, AttributeValue>;
export type HttpAttributes = Record<string, AttributeValue>;

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

interface InstrumentationContext {
  config: AutoInstrumentConfig;
  adapter?: RuntimeAdapter;
  initialized: boolean;
}

export interface InstrumentOptions {
  attributes?: (args: unknown[]) => SpanAttributes;
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
}

export interface BatchOptions {
  batchSize?: number;
  attributes?: SpanAttributes;
}
