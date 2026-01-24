import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { OpenTelemetryAPI, TracingConfig, TracingState } from "./types.ts";
import { loadConfig } from "./config.ts";
import { SpanOperations } from "./span-operations.ts";
import { ContextPropagation } from "./context-propagation.ts";

/**
 * Tracing manager class
 * Exported for testing - use tracingManager singleton for production
 */
export class TracingManager {
  private state: TracingState = {
    initialized: false,
    degraded: false,
    tracer: null,
    api: null,
    propagator: null,
  };

  private spanOps: SpanOperations | null = null;
  private contextProp: ContextPropagation | null = null;

  async initialize(config: Partial<TracingConfig> = {}, adapter?: RuntimeAdapter): Promise<void> {
    if (this.state.initialized) {
      logger.debug("[tracing] Already initialized");
      return;
    }

    const finalConfig = loadConfig(config, adapter);

    this.state.initialized = true;

    if (!finalConfig.enabled) {
      logger.debug("[tracing] Tracing disabled");
      return;
    }

    try {
      await this.initializeTracer(finalConfig);

      logger.info("[tracing] OpenTelemetry tracing initialized", {
        exporter: finalConfig.exporter,
        serviceName: finalConfig.serviceName,
        endpoint: finalConfig.endpoint,
      });
    } catch (error) {
      logger.error(
        "[tracing] Failed to initialize OpenTelemetry tracing - running in degraded mode",
        error,
      );
      this.state.degraded = true;
    }
  }

  private async initializeTracer(config: TracingConfig): Promise<void> {
    const api = (await import("@opentelemetry/api")) as OpenTelemetryAPI;
    this.state.api = api;

    this.state.tracer = api.trace.getTracer(config.serviceName || "veryfront", "0.1.0");

    const { W3CTraceContextPropagator } = await import("@opentelemetry/core");
    const propagator = new W3CTraceContextPropagator();
    this.state.propagator = propagator;
    api.propagation.setGlobalPropagator(propagator);

    if (this.state.tracer) {
      this.spanOps = new SpanOperations(api, this.state.tracer);
    }

    this.contextProp = new ContextPropagation(api, propagator);
  }

  isEnabled(): boolean {
    return this.state.initialized && this.state.tracer !== null;
  }

  isDegraded(): boolean {
    return this.state.degraded;
  }

  getSpanOperations(): SpanOperations | null {
    return this.spanOps;
  }

  getContextPropagation(): ContextPropagation | null {
    return this.contextProp;
  }

  getState(): TracingState {
    return this.state;
  }

  shutdown(): void {
    if (!this.state.initialized) return;

    try {
      logger.info("[tracing] Tracing shutdown initiated");
    } catch (error) {
      logger.warn("[tracing] Error during tracing shutdown", error);
    }
  }
}

export const tracingManager = new TracingManager();
