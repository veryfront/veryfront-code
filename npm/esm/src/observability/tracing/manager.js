import { serverLogger as logger } from "../../utils/index.js";
import { loadConfig } from "./config.js";
import { SpanOperations } from "./span-operations.js";
import { ContextPropagation } from "./context-propagation.js";
/**
 * Tracing manager class
 * Exported for testing - use tracingManager singleton for production
 */
export class TracingManager {
    state = {
        initialized: false,
        degraded: false,
        tracer: null,
        api: null,
        propagator: null,
    };
    spanOps = null;
    contextProp = null;
    async initialize(config = {}, adapter) {
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
        }
        catch (error) {
            logger.error("[tracing] Failed to initialize OpenTelemetry tracing - running in degraded mode", error);
            this.state.degraded = true;
        }
    }
    async initializeTracer(config) {
        const api = (await import("@opentelemetry/api"));
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
    isEnabled() {
        return this.state.initialized && this.state.tracer !== null;
    }
    isDegraded() {
        return this.state.degraded;
    }
    getSpanOperations() {
        return this.spanOps;
    }
    getContextPropagation() {
        return this.contextProp;
    }
    getState() {
        return this.state;
    }
    shutdown() {
        if (!this.state.initialized)
            return;
        try {
            logger.info("[tracing] Tracing shutdown initiated");
        }
        catch (error) {
            logger.warn("[tracing] Error during tracing shutdown", error);
        }
    }
}
export const tracingManager = new TracingManager();
