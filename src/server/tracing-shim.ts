import { tryResolve } from "veryfront/extensions";
import type { TracingExporter } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  type GlobalTelemetryAPIConfig,
  installGlobalTelemetryAPI,
} from "#veryfront/observability/tracing/api-shim.ts";
import { __registerLogRecordEmitter, logger } from "#veryfront/utils/logger/logger.ts";

const bootstrapLog = logger.component("bootstrap");

/**
 * Wire the `TracingExporter` contract (if registered) into the core shim.
 * Must be called after `orchestrateExtensions()` completes.
 * The returned disposer clears only this installation, never a newer owner.
 */
export function wireTracingShim(): () => boolean {
  const tracing = tryResolve<TracingExporter>("TracingExporter");
  // Read every extension getter, including the log bridge, before installing
  // anything. A getter failure must not publish a partial telemetry facade.
  const config = {
    tracerProvider: tracing?.getProvider(),
    metricsApi: tracing?.getMetricsAPI(),
    activeSpanAccessor: tracing?.getTraceAPI?.(),
    contextAccessor: tracing?.getContextAPI?.(),
    propagator: tracing?.getPropagator?.(),
  } as GlobalTelemetryAPIConfig;
  const logRecordEmitter = tracing?.getLogRecordEmitter?.() ?? null;
  const installation = installGlobalTelemetryAPI(config);
  const dispose = (): boolean => {
    if (!installation.dispose()) return false;
    __registerLogRecordEmitter(null);
    return true;
  };
  try {
    __registerLogRecordEmitter(logRecordEmitter);
    bootstrapLog.debug(
      tracing
        ? "[bootstrap] TracingExporter wired into shim"
        : "[bootstrap] no TracingExporter extension — using no-op tracer",
    );
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
