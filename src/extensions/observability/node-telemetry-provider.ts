/**
 * Contract interface for Node.js OpenTelemetry runtime bootstrap.
 *
 * Default implementation: `@veryfront/ext-observability-opentelemetry`
 *
 * @module extensions/observability/node-telemetry-provider
 */

export const NodeTelemetryProviderName = "NodeTelemetryProvider";

/** Configuration used by node telemetry instrumentation. */
export type NodeTelemetryInstrumentationConfig = {
  http: boolean;
  express: boolean;
  fs: boolean;
};

/** Public API contract for node telemetry logger. */
export type NodeTelemetryLogger = {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

/** Public API contract for node telemetry process target. */
export type NodeTelemetryProcessTarget = {
  on(event: "SIGTERM", listener: () => void | Promise<void>): unknown;
};

/** Structured log record shape accepted by the telemetry provider. */
export type NodeTelemetryLogRecord = {
  timestamp?: string;
  level?: string;
  service?: string;
  message: string;
  component?: string;
  context?: Record<string, unknown>;
  error?: unknown;
  trace_id?: string;
  span_id?: string;
  run_id?: string;
  agent_id?: string;
  thread_id?: string;
  schedule_id?: string;
  schedule_name?: string;
  tool_name?: string;
  tool_call_id?: string;
};

/** Emits a structured logger record into the active telemetry pipeline. */
export type NodeTelemetryLogRecordEmitter = (record: NodeTelemetryLogRecord) => void;

/** Options accepted by node telemetry initialize. */
export type NodeTelemetryInitializeOptions = {
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
  samplingRatio: number;
  exporterHeaders?: Record<string, string>;
  tracesEnabled?: boolean;
  metricsEnabled?: boolean;
  logsEnabled?: boolean;
  tracesEndpoint?: string;
  llmObservabilityEnabled?: boolean;
  llmObservabilityEndpoint?: string;
  metricsEndpoint?: string;
  logsEndpoint?: string;
  tracesHeaders?: Record<string, string>;
  llmObservabilityHeaders?: Record<string, string>;
  metricsHeaders?: Record<string, string>;
  logsHeaders?: Record<string, string>;
  metricsExportIntervalMillis?: number;
  metricsTemporalityPreference?: "delta" | "cumulative" | "lowmemory";
  instrumentation: NodeTelemetryInstrumentationConfig;
  logger?: NodeTelemetryLogger;
  processTarget?: NodeTelemetryProcessTarget;
  registerLogRecordEmitter?: (emitter: NodeTelemetryLogRecordEmitter) => void;
};

/**
 * Initializes Node-specific OpenTelemetry SDK behavior.
 *
 * This contract covers NodeSDK and auto-instrumentation setup. It is separate
 * from `TracingExporter`, which only exposes tracing APIs to the core shim.
 */
export interface NodeTelemetryProvider {
  initialize(options: NodeTelemetryInitializeOptions): Promise<boolean>;
}
