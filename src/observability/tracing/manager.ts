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
    const api = (await import("@opentelemetry/api")) as OpenTelemetryAPI;
    this.state.api = api;

    const { W3CTraceContextPropagator } = await import("@opentelemetry/core");
    const propagator = new W3CTraceContextPropagator();
    this.state.propagator = propagator;
    api.propagation.setGlobalPropagator(propagator);

    if (config.exporter === "console") {
      await this.initializeConsoleTracer(api, config);
    } else if (config.exporter === "otlp" && config.endpoint) {
      await this.initializeOTLPTracer(api, config);
    } else {
      // Fallback: tracer without processor (spans are no-ops)
      this.state.tracer = api.trace.getTracer(config.serviceName ?? "veryfront", VERSION);
    }

    this.spanOps = this.state.tracer ? new SpanOperations(api, this.state.tracer) : null;
    this.contextProp = new ContextPropagation(api, propagator);
  }

  private async initializeConsoleTracer(
    api: OpenTelemetryAPI,
    config: TracingConfig,
  ): Promise<void> {
    const { BasicTracerProvider, SimpleSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    const { Resource } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
      "@opentelemetry/semantic-conventions"
    );
    const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
    const { ConsoleSpanExporter } = await import("./exporters/console-exporter.ts");

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName ?? "veryfront",
      [ATTR_SERVICE_VERSION]: VERSION,
    });

    const provider = new BasicTracerProvider({ resource });
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));

    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    provider.register({ contextManager });

    this.state.tracer = api.trace.getTracer(config.serviceName ?? "veryfront", VERSION);
  }

  private async initializeOTLPTracer(api: OpenTelemetryAPI, config: TracingConfig): Promise<void> {
    const { BasicTracerProvider, BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
      "@opentelemetry/semantic-conventions"
    );
    const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName ?? "veryfront",
      [ATTR_SERVICE_VERSION]: VERSION,
    });

    const endpointBase = (config.endpoint ?? "").replace(/\/$/, "");
    const exporter = new OTLPTraceExporter({
      url: `${endpointBase}/v1/traces`,
    });

    const provider = new BasicTracerProvider({ resource });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));

    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    provider.register({ contextManager });

    this.state.tracer = api.trace.getTracer(config.serviceName ?? "veryfront", VERSION);
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
