import { serverLogger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import type { ObservabilityRuntimeAdapter } from "../runtime-adapter.ts";
import { loadConfig } from "./config.ts";
import { ContextPropagation } from "./context-propagation.ts";
import { SpanOperations } from "./span-operations.ts";
import type { OpenTelemetryAPI, TracingConfig, TracingState } from "./types.ts";
import { classifyTelemetryError } from "../telemetry-safety.ts";
import { getTracerProviderRevision } from "./api-shim.ts";

const logger = serverLogger.component("tracing");

function createInitialState(): TracingState {
  return {
    initialized: false,
    degraded: false,
    tracer: null,
    api: null,
    propagator: null,
  };
}

function safeLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
): void {
  try {
    logger[level](message, context);
  } catch {
    // Telemetry logging must not affect application execution.
  }
}

/**
 * Tracing manager class
 * Exported for testing - use tracingManager singleton for production
 */
export class TracingManager {
  private state: TracingState = createInitialState();

  private spanOps: SpanOperations | null = null;
  private contextProp: ContextPropagation | null = null;
  private initializationPromise: Promise<void> | null = null;
  private providerRevision = -1;
  private serviceName = "veryfront";

  async initialize(
    config: Partial<TracingConfig> = {},
    adapter?: ObservabilityRuntimeAdapter,
  ): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    if (this.state.initialized) {
      safeLog("debug", "Already initialized");
      return;
    }

    this.initializationPromise = this.initializeOnce(config, adapter);
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async initializeOnce(
    config: Partial<TracingConfig>,
    adapter?: ObservabilityRuntimeAdapter,
  ): Promise<void> {
    const finalConfig = loadConfig(config, adapter);
    this.state.initialized = true;

    if (!finalConfig.enabled) {
      safeLog("debug", "Tracing disabled");
      return;
    }

    try {
      await this.initializeTracer(finalConfig);

      safeLog("info", "OpenTelemetry tracing initialized", {
        exporter: finalConfig.exporter,
      });
    } catch (error) {
      safeLog(
        "error",
        "[tracing] Failed to initialize OpenTelemetry tracing - running in degraded mode",
        { failure_category: classifyTelemetryError(error) },
      );
      this.state.degraded = true;
    }
  }

  private async initializeTracer(config: TracingConfig): Promise<void> {
    // Use the shim API. It delegates to the real SDK when ext-observability-opentelemetry is wired.
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

    this.serviceName = config.serviceName ?? "veryfront";
    this.state.tracer = api.trace.getTracer(this.serviceName, VERSION);
    this.providerRevision = getTracerProviderRevision();

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

    this.spanOps = this.state.tracer ? new SpanOperations(api, this.state.tracer) : null;
    this.contextProp = new ContextPropagation(api, propagator);
  }

  isEnabled(): boolean {
    this.refreshTracer();
    return this.state.initialized && this.state.tracer !== null;
  }

  isDegraded(): boolean {
    return this.state.degraded;
  }

  getSpanOperations(): SpanOperations | null {
    this.refreshTracer();
    return this.spanOps;
  }

  getContextPropagation(): ContextPropagation | null {
    return this.contextProp;
  }

  getState(): TracingState {
    return { ...this.state };
  }

  shutdown(): void {
    if (!this.state.initialized) return;

    safeLog("info", "Tracing shutdown initiated");
    this.state = createInitialState();
    this.spanOps = null;
    this.contextProp = null;
    this.providerRevision = -1;
    this.serviceName = "veryfront";
  }

  private refreshTracer(): void {
    if (!this.state.initialized || !this.state.api || !this.state.tracer) return;
    const revision = getTracerProviderRevision();
    if (revision === this.providerRevision) return;

    try {
      this.state.tracer = this.state.api.trace.getTracer(this.serviceName, VERSION);
      this.spanOps = new SpanOperations(this.state.api, this.state.tracer);
      this.providerRevision = revision;
      this.state.degraded = false;
    } catch (error) {
      this.state.degraded = true;
      safeLog("warn", "Failed to refresh OpenTelemetry tracer", {
        failure_category: classifyTelemetryError(error),
      });
    }
  }
}

export const tracingManager = new TracingManager();
