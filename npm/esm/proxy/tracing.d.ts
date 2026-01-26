/**
 * OpenTelemetry OTLP tracing for proxy.
 * Env: OTEL_TRACES_ENABLED, OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
 */
import * as dntShim from "../_dnt.shims.js";
import type { Context, Span } from "@opentelemetry/api";
export declare function initializeOTLP(): Promise<void>;
export declare function shutdownOTLP(): Promise<void>;
export declare function isOTLPEnabled(): boolean;
export declare function extractContext(headers: dntShim.Headers): Context | undefined;
export declare function injectContext(headers: dntShim.Headers): void;
export declare function startServerSpan(method: string, path: string, parentContext?: Context): {
    span: Span;
    context: Context;
} | null;
export declare function endSpan(span: Span | undefined, statusCode: number, error?: Error): void;
export declare function withContext<T>(spanContext: Context, fn: () => Promise<T>): Promise<T>;
export declare function getTraceContext(): {
    traceId?: string;
    spanId?: string;
};
/**
 * Span names for proxy tracing.
 */
export declare const ProxySpanNames: {
    readonly PROXY_REQUEST: "proxy.request";
    readonly PROXY_PROCESS: "proxy.process";
    readonly PROXY_TOKEN_FETCH: "proxy.token_fetch";
    readonly PROXY_DOMAIN_LOOKUP: "proxy.domain_lookup";
    readonly OAUTH_TOKEN_REQUEST: "oauth.token_request";
    readonly HTTP_CLIENT_FETCH: "http.client.fetch";
};
/**
 * Execute an async function within a tracing span.
 * If tracing is disabled, executes the function directly.
 */
export declare function withSpan<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, string | number | boolean>): Promise<T>;
export { initializeOTLP as initializeOTLPWithApis };
//# sourceMappingURL=tracing.d.ts.map