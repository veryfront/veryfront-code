/**
 * OpenTelemetry OTLP Setup for Grafana Cloud
 *
 * Configures the OTLP exporter to send traces to Grafana Cloud.
 * Reads configuration from environment variables:
 * - OTEL_TRACES_ENABLED: "true" to enable tracing
 * - OTEL_SERVICE_NAME: Service name for traces
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint (e.g., https://otlp-gateway-prod-eu-west-2.grafana.net/otlp)
 * - OTEL_EXPORTER_OTLP_HEADERS: Auth headers (e.g., Authorization=Basic ...)
 */
import * as dntShim from "../../../_dnt.shims.js";
export interface OTLPConfig {
    serviceName: string;
    endpoint: string;
    headers?: Record<string, string>;
    enabled: boolean;
}
export declare function initializeOTLP(): Promise<void>;
export declare function shutdownOTLP(): Promise<void>;
export declare function isOTLPEnabled(): boolean;
/**
 * Execute an async function within a new span.
 * Creates a child span of the current active span.
 * If tracing is disabled, just executes the function.
 */
export declare function withSpan<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, string | number | boolean>): Promise<T>;
/**
 * Execute a sync function within a new span.
 */
export declare function withSpanSync<T>(name: string, fn: () => T, attributes?: Record<string, string | number | boolean>): T;
/**
 * Extract trace context from incoming request headers
 */
export declare function extractContext(headers: dntShim.Headers): unknown;
/**
 * Inject trace context into outgoing request headers
 */
export declare function injectContext(headers: dntShim.Headers): void;
/**
 * Start a server span for an incoming HTTP request
 */
export declare function startServerSpan(method: string, path: string, parentContext?: unknown): {
    span: unknown;
    context: unknown;
} | null;
/**
 * End a span with status code and optional error
 */
export declare function endServerSpan(span: unknown, statusCode: number, error?: Error): void;
/**
 * Set attributes on a span
 */
export declare function setSpanAttributes(span: unknown, attributes: Record<string, string | number | boolean>): void;
/**
 * Set attributes on the currently active span (if any).
 * Useful for adding response metadata inside withSpan callbacks.
 */
export declare function setActiveSpanAttributes(attributes: Record<string, string | number | boolean>): void;
/**
 * Execute a function within a span context
 */
export declare function withContext<T>(spanContext: unknown, fn: () => Promise<T>): Promise<T>;
/**
 * Get current trace context info (for logging correlation)
 */
export declare function getTraceContext(): {
    traceId?: string;
    spanId?: string;
};
/**
 * Initialize OTLP with API loading for span creation
 */
export declare function initializeOTLPWithApis(): Promise<void>;
//# sourceMappingURL=otlp-setup.d.ts.map