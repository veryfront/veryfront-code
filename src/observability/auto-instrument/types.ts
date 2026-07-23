/** Code-owned attributes accepted by HTTP instrumentation hooks. */
export type HttpAttributes = Record<string, string | number | boolean>;

/** Options for automatic HTTP handler instrumentation. */
export interface HttpHandlerInstrumentationOptions {
  /** A stable, code-owned route template such as `/projects/{project}`. */
  routeTemplate?: string;
}

/** Tracing settings accepted by automatic instrumentation. */
export interface AutoInstrumentationTracingConfig {
  /** Whether tracing is enabled. */
  enabled: boolean;
  /** Trace exporter selected for this runtime. */
  exporter?: "jaeger" | "zipkin" | "otlp" | "console";
  /** Optional exporter endpoint. */
  endpoint?: string;
  /** Service name attached to emitted spans. */
  serviceName?: string;
}

/** Metrics settings accepted by automatic instrumentation. */
export interface AutoInstrumentationMetricsConfig {
  /** Whether metrics collection is enabled. */
  enabled: boolean;
  /** Metrics exporter selected for this runtime. */
  exporter?: "prometheus" | "otlp" | "console";
  /** Optional exporter endpoint. */
  endpoint?: string;
  /** Prefix applied to metric instrument names. */
  prefix?: string;
}

/** Configuration used by auto instrument. */
export interface AutoInstrumentConfig {
  /** Tracing configuration forwarded to the tracing manager. */
  tracing?: AutoInstrumentationTracingConfig;
  /** Metrics configuration forwarded to the metrics manager. */
  metrics?: AutoInstrumentationMetricsConfig;
  /** Whether HTTP handlers are eligible for automatic instrumentation. */
  instrumentHttp?: boolean;
  /** Whether outbound fetch calls are eligible for automatic instrumentation. */
  instrumentFetch?: boolean;
  /** Whether React rendering is eligible for automatic instrumentation. */
  instrumentReact?: boolean;
  /** Whether automatic wrappers capture sanitized error status. */
  captureErrors?: boolean;
}

/** Options accepted by automatic operation wrappers. */
export interface InstrumentOptions {
  /**
   * Legacy attribute callback retained for source compatibility.
   *
   * @deprecated Automatic wrappers do not evaluate or emit custom attributes.
   * Use an explicit manual span for trusted, code-owned attributes.
   */
  attributes?: (args: unknown[]) => unknown;
  /** OpenTelemetry span kind for the wrapped operation. */
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
}

/** Options accepted by batched automatic operation wrappers. */
export interface BatchOptions {
  /** Maximum number of items processed concurrently in one batch. */
  batchSize?: number;
  /**
   * Legacy batch attributes retained for source compatibility.
   *
   * @deprecated Automatic wrappers do not emit custom batch attributes.
   * Use an explicit manual span for trusted, code-owned attributes.
   */
  attributes?: unknown;
}
