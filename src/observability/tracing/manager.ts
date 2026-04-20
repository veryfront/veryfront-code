import { serverLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { loadConfig } from "./config.ts";
import { ContextPropagation } from "./context-propagation.ts";
import { SpanOperations } from "./span-operations.ts";
import type { OpenTelemetryAPI, TracingConfig, TracingState } from "./types.ts";

const logger = serverLogger.component("tracing");

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
      logger.debug("Already initialized");
      return;
    }

    const finalConfig = loadConfig(config, adapter);
    this.state.initialized = true;

    if (!finalConfig.enabled) {
      logger.debug("Tracing disabled");
      return;
    }

    try {
      await this.initializeTracer(finalConfig);

      logger.info("OpenTelemetry tracing initialized", {
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
    // Use the shim API — delegates to the real SDK when ext-opentelemetry is wired.
    const shimApi = await import("./api-shim.ts");
    const api: OpenTelemetryAPI = {
      trace: {
        getTracer: (name, version) => shimApi.getTracer(name ?? "veryfront", version),
        setSpan: (ctx, _span) => ctx,
      },
      propagation: {
        setGlobalPropagator: (p) => shimApi.propagation.setGlobalPropagator(p),
        extract: (ctx, carrier) => shimApi.propagation.extract(ctx, carrier),
        inject: (ctx, carrier) => shimApi.propagation.inject(ctx, carrier),
      },
      context: {
        active: () => shimApi.context.active(),
        with: (ctx, fn) => shimApi.context.with(ctx, fn),
      },
      SpanKind: shimApi.SpanKind,
      SpanStatusCode: { OK: shimApi.SpanStatusCode.OK, ERROR: shimApi.SpanStatusCode.ERROR },
    };
    this.state.api = api;

    this.state.tracer = api.trace.getTracer(config.serviceName ?? "veryfront", VERSION);

    // Use shim propagation (no external dep needed for W3C propagation in no-op mode)
    const propagator = {
      inject: (ctx: import("./api-shim.ts").Context, carrier: unknown) =>
        shimApi.propagation.inject(ctx, carrier),
      extract: (ctx: import("./api-shim.ts").Context, carrier: unknown) =>
        shimApi.propagation.extract(ctx, carrier),
      fields: () => [] as string[],
    };
    this.state.propagator = propagator;
    api.propagation.setGlobalPropagator(propagator);

    this.spanOps = this.state.tracer ? new SpanOperations(api, this.state.tracer) : null;
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
      logger.info("Tracing shutdown initiated");
    } catch (error) {
      logger.warn("Error during tracing shutdown", error);
    }
  }
}

export const tracingManager = new TracingManager();
