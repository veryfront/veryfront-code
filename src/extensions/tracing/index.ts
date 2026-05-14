/**
 * Tracing category barrel: tracing and Node telemetry contracts.
 *
 * @module extensions/tracing
 */

export type { SpanData, TracerProvider, TracingExporter } from "./tracing-exporter.ts";
export type {
  NodeTelemetryInitializeOptions,
  NodeTelemetryInstrumentationConfig,
  NodeTelemetryLogger,
  NodeTelemetryProcessTarget,
  NodeTelemetryProvider,
} from "./node-telemetry-provider.ts";
export { NodeTelemetryProviderName } from "./node-telemetry-provider.ts";
