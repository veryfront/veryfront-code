import { tryResolve } from "veryfront/extensions";
import type { TracingExporter } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  propagation,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalMetricsAPI,
  setGlobalTracerProvider,
  type TextMapPropagator,
} from "#veryfront/observability/tracing/api-shim.ts";
import { __registerLogRecordEmitter, logger } from "#veryfront/utils/logger/logger.ts";

const bootstrapLog = logger.component("bootstrap");

/**
 * Wire the `TracingExporter` contract (if registered) into the core shim.
 * Must be called after `orchestrateExtensions()` completes.
 */
export function wireTracingShim(): void {
  const tracing = tryResolve<TracingExporter>("TracingExporter");
  if (tracing) {
    setGlobalTracerProvider(
      tracing.getProvider() as Parameters<typeof setGlobalTracerProvider>[0],
    );
    const metricsApi = tracing.getMetricsAPI();
    if (metricsApi) {
      setGlobalMetricsAPI(
        metricsApi as Parameters<typeof setGlobalMetricsAPI>[0],
      );
    }
    const traceApi = tracing.getTraceAPI?.();
    if (traceApi) {
      setGlobalActiveSpanAccessor(
        traceApi as Parameters<typeof setGlobalActiveSpanAccessor>[0],
      );
    }
    const contextApi = tracing.getContextAPI?.();
    if (contextApi) {
      setGlobalContextAccessor(
        contextApi as Parameters<typeof setGlobalContextAccessor>[0],
      );
    }
    propagation.setGlobalPropagator(
      (tracing.getPropagator?.() ?? null) as TextMapPropagator | null,
    );
    const logRecordEmitter = tracing.getLogRecordEmitter?.();
    __registerLogRecordEmitter(logRecordEmitter ?? null);
    bootstrapLog.debug("[bootstrap] TracingExporter wired into shim");
  } else {
    propagation.setGlobalPropagator(null);
    __registerLogRecordEmitter(null);
    bootstrapLog.debug("[bootstrap] no TracingExporter extension — using no-op tracer");
  }
}
