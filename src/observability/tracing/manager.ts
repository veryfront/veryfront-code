import { serverLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { getGlobalTelemetryAPISnapshot } from "./api-shim.ts";
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
  private configuredEnabled = false;
  private providerRevision = -1;
  private serviceName = "veryfront";

  async initialize(config: Partial<TracingConfig> = {}, adapter?: RuntimeAdapter): Promise<void> {
    if (this.state.initialized) {
      logger.debug("Already initialized");
      return;
    }

    const finalConfig = loadConfig(config, adapter);
    this.state.initialized = true;
    this.configuredEnabled = finalConfig.enabled;
    this.serviceName = finalConfig.serviceName ?? "veryfront";

    if (!finalConfig.enabled) {
      logger.debug("Tracing disabled");
      return;
    }

    try {
      await this.initializeTracer();

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

  private async initializeTracer(): Promise<void> {
    // Use the shim API — delegates to the real SDK when ext-observability-opentelemetry is wired.
    const shimApi = await import("./api-shim.ts");
    const api: OpenTelemetryAPI = {
      trace: {
        getTracer: (name, version) => shimApi.getTracer(name ?? "veryfront", version),
        setSpan: (ctx, span) => shimApi.trace.setSpan(ctx, span),
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

    // No-op propagator used only when ext-observability-opentelemetry is NOT installed.
    // When the extension is active, it registers W3CTraceContextPropagator
    // on the shim directly; we intentionally do NOT wrap shimApi.propagation
    // here (doing so would cause infinite recursion when the global
    // propagator is the wrapper itself).
    const propagator = {
      inject: (_ctx: import("./api-shim.ts").Context, _carrier: unknown) => {},
      extract: (ctx: import("./api-shim.ts").Context, _carrier: unknown) => ctx,
      fields: () => [] as string[],
    };
    this.state.propagator = propagator;
    this.refreshProvider(true);
  }

  private refreshProvider(force = false): void {
    if (!this.state.initialized || !this.configuredEnabled || !this.state.api) return;

    const snapshot = getGlobalTelemetryAPISnapshot();
    if (!force && snapshot.tracerProviderRevision === this.providerRevision) return;
    this.providerRevision = snapshot.tracerProviderRevision;

    if (!snapshot.tracerProviderInstalled) {
      this.state.tracer = null;
      this.spanOps = null;
      this.contextProp = null;
      return;
    }

    try {
      const tracer = this.state.api.trace.getTracer(this.serviceName, VERSION);
      this.state.tracer = tracer;
      this.spanOps = new SpanOperations(this.state.api, tracer);
      this.contextProp = this.state.propagator
        ? new ContextPropagation(this.state.api, this.state.propagator)
        : null;
      this.state.degraded = false;
    } catch (error) {
      this.state.tracer = null;
      this.spanOps = null;
      this.contextProp = null;
      this.state.degraded = true;
      try {
        logger.warn("Failed to refresh OpenTelemetry tracer provider", error);
      } catch (_) {
        /* expected: telemetry lifecycle remains fail-open */
      }
    }
  }

  isEnabled(): boolean {
    this.refreshProvider();
    return this.state.initialized && this.state.tracer !== null;
  }

  isDegraded(): boolean {
    return this.state.degraded;
  }

  getSpanOperations(): SpanOperations | null {
    this.refreshProvider();
    return this.spanOps;
  }

  getContextPropagation(): ContextPropagation | null {
    this.refreshProvider();
    return this.contextProp;
  }

  getState(): TracingState {
    this.refreshProvider();
    return this.state;
  }

  shutdown(): void {
    if (!this.state.initialized) return;

    try {
      logger.info("Tracing shutdown initiated");
    } catch (error) {
      logger.warn("Error during tracing shutdown", error);
    }
    this.state = {
      initialized: false,
      degraded: false,
      tracer: null,
      api: null,
      propagator: null,
    };
    this.spanOps = null;
    this.contextProp = null;
    this.configuredEnabled = false;
    this.providerRevision = -1;
    this.serviceName = "veryfront";
  }
}

export const tracingManager = new TracingManager();
