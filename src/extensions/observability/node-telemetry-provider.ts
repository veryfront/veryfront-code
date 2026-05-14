/**
 * Contract interface for Node.js OpenTelemetry runtime bootstrap.
 *
 * Default implementation: `@veryfront/ext-observability-opentelemetry`
 *
 * @module extensions/observability/node-telemetry-provider
 */

export const NodeTelemetryProviderName = "NodeTelemetryProvider";

export type NodeTelemetryInstrumentationConfig = {
  http: boolean;
  express: boolean;
  fs: boolean;
};

export type NodeTelemetryLogger = {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

export type NodeTelemetryProcessTarget = {
  on(event: "SIGTERM", listener: () => void | Promise<void>): unknown;
};

export type NodeTelemetryInitializeOptions = {
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
  samplingRatio: number;
  exporterHeaders?: Record<string, string>;
  instrumentation: NodeTelemetryInstrumentationConfig;
  logger?: NodeTelemetryLogger;
  processTarget?: NodeTelemetryProcessTarget;
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
