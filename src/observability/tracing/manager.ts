import { serverLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { OpenTelemetryAPI, TracingConfig, TracingState } from "./types.ts";
import { loadConfig } from "./config.ts";
import { SpanOperations } from "./span-operations.ts";
import { ContextPropagation } from "./context-propagation.ts";

class TracingManager {
  private state: TracingState = {
    initialized: false,
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

    if (!finalConfig.enabled) {
      logger.debug("[tracing] Tracing disabled");
      this.state.initialized = true;
      return;
    }

    try {
      await this.initializeTracer(finalConfig);
      this.state.initialized = true;

      logger.info("[tracing] OpenTelemetry tracing initialized", {
        exporter: finalConfig.exporter,
        serviceName: finalConfig.serviceName,
        endpoint: finalConfig.endpoint,
      });
    } catch (error) {
      logger.warn("[tracing] Failed to initialize OpenTelemetry tracing", error);
      this.state.initialized = true;
    }
  }

  private async initializeTracer(config: TracingConfig): Promise<void> {
    // Construct module names dynamically to prevent Deno static analyzer
    // from trying to resolve these npm packages during lint/check
    const otelApiModule = ["npm:@opentelemetry/", "api@1"].join("");
    const api = await import(otelApiModule) as OpenTelemetryAPI;
    this.state.api = api;

    this.state.tracer = api.trace.getTracer(config.serviceName || "veryfront", "0.1.0");

    const otelCoreModule = ["npm:@opentelemetry/", "core@1"].join("");
    const { W3CTraceContextPropagator } = await import(otelCoreModule);
    const propagator = new W3CTraceContextPropagator();
    this.state.propagator = propagator;
    api.propagation.setGlobalPropagator(propagator);

    if (this.state.api && this.state.tracer) {
      this.spanOps = new SpanOperations(this.state.api, this.state.tracer);
    }

    if (this.state.api && this.state.propagator) {
      this.contextProp = new ContextPropagation(this.state.api, this.state.propagator);
    }
  }

  isEnabled(): boolean {
    return this.state.initialized && this.state.tracer !== null;
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
