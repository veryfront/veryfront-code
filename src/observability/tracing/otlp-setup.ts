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

import { serverLogger as logger } from "#veryfront/utils";
import { getOtelTracingConfig } from "#veryfront/config/env.ts";

let initialized = false;

interface ShutdownableProvider {
  shutdown(): Promise<void>;
}

let tracerProvider: ShutdownableProvider | null = null;

export interface OTLPConfig {
  serviceName: string;
  endpoint: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

let traceApi: typeof import("@opentelemetry/api") | null = null;
let propagationApi: typeof import("@opentelemetry/core") | null = null;

function parseHeaders(headerString: string | undefined): Record<string, string> {
  if (!headerString) return {};

  if (headerString.startsWith("Basic ")) {
    return { Authorization: headerString };
  }

  if (headerString.startsWith("Authorization=")) {
    return { Authorization: headerString.substring("Authorization=".length) };
  }

  const headers: Record<string, string> = {};
  for (const part of headerString.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (!key || valueParts.length === 0) continue;
    headers[key.trim()] = valueParts.join("=").trim();
  }
  return headers;
}

function getConfig(): OTLPConfig {
  const tracingConfig = getOtelTracingConfig();

  return {
    enabled: tracingConfig.enabledFlag === "true",
    serviceName: tracingConfig.serviceName || "veryfront",
    endpoint: tracingConfig.endpoint || "",
    headers: parseHeaders(tracingConfig.headers),
  };
}

async function ensureApis(): Promise<void> {
  if (traceApi && propagationApi) return;
  traceApi = await import("@opentelemetry/api");
  propagationApi = await import("@opentelemetry/core");
}

export async function initializeOTLP(): Promise<void> {
  if (initialized) {
    logger.debug("[otel] Already initialized");
    return;
  }

  const config = getConfig();

  if (!config.enabled) {
    logger.debug("[otel] Tracing disabled (OTEL_TRACES_ENABLED != true)");
    initialized = true;
    return;
  }

  if (!config.endpoint) {
    logger.warn("[otel] No OTEL_EXPORTER_OTLP_ENDPOINT configured, skipping");
    initialized = true;
    return;
  }

  try {
    const { BasicTracerProvider, BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");
    const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");

    const resource = new Resource({ [ATTR_SERVICE_NAME]: config.serviceName });

    const endpointBase = config.endpoint.replace(/\/$/, "");
    const exporter = new OTLPTraceExporter({
      url: `${endpointBase}/v1/traces`,
      headers: config.headers,
    });

    const provider = new BasicTracerProvider({ resource });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));

    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    provider.register({ contextManager });

    tracerProvider = provider;

    // MUST be set before marking as initialized, otherwise withSpan will skip creating spans.
    traceApi = await import("@opentelemetry/api");

    initialized = true;
    logger.info("[otel] OpenTelemetry OTLP tracing initialized", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });

    traceApi.trace.getTracer(config.serviceName);
    logger.debug("[otel] Tracer obtained", { name: config.serviceName });
  } catch (error) {
    logger.error("[otel] Failed to initialize OTLP tracing", { error });
    initialized = true; // Mark as initialized to prevent retries
  }
}

export async function shutdownOTLP(): Promise<void> {
  if (!tracerProvider) return;

  try {
    await tracerProvider.shutdown();
    logger.info("[otel] Tracer provider shutdown complete");
  } catch (error) {
    logger.warn("[otel] Error during tracer shutdown", { error });
  }
}

export function isOTLPEnabled(): boolean {
  return initialized && tracerProvider !== null;
}

/**
 * Execute an async function within a new span.
 * Creates a child span of the current active span.
 * If tracing is disabled, just executes the function.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!traceApi || !isOTLPEnabled()) return await fn();

  const tracingConfig = getOtelTracingConfig();
  const serviceName = tracingConfig.serviceName || "veryfront-renderer";
  const tracer = traceApi.trace.getTracer(serviceName);
  const parentContext = traceApi.context.active();

  const span = tracer.startSpan(
    name,
    { kind: traceApi.SpanKind.INTERNAL, attributes },
    parentContext,
  );

  const spanContext = traceApi.trace.setSpan(parentContext, span);

  try {
    const result = await traceApi.context.with(spanContext, fn);
    span.setStatus({ code: traceApi.SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: traceApi.SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute a sync function within a new span.
 */
export function withSpanSync<T>(
  name: string,
  fn: () => T,
  attributes?: Record<string, string | number | boolean>,
): T {
  if (!traceApi || !isOTLPEnabled()) return fn();

  const tracingConfig = getOtelTracingConfig();
  const serviceName = tracingConfig.serviceName || "veryfront-renderer";
  const tracer = traceApi.trace.getTracer(serviceName);
  const parentContext = traceApi.context.active();

  const span = tracer.startSpan(
    name,
    { kind: traceApi.SpanKind.INTERNAL, attributes },
    parentContext,
  );

  try {
    const result = fn();
    span.setStatus({ code: traceApi.SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: traceApi.SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Extract trace context from incoming request headers
 */
export function extractContext(headers: Headers): unknown {
  if (!traceApi || !propagationApi) return traceApi?.context?.active();

  const carrier: Record<string, string> = {};
  for (const [k, v] of headers) carrier[k.toLowerCase()] = v;

  if (!propagationApi.W3CTraceContextPropagator) return traceApi.context.active();

  return new propagationApi.W3CTraceContextPropagator().extract(
    traceApi.context.active(),
    carrier,
    traceApi.defaultTextMapGetter,
  );
}

/**
 * Inject trace context into outgoing request headers
 */
export function injectContext(headers: Headers): void {
  if (!traceApi || !propagationApi) return;

  const carrier: Record<string, string> = {};
  new propagationApi.W3CTraceContextPropagator().inject(
    traceApi.context.active(),
    carrier,
    traceApi.defaultTextMapSetter,
  );

  for (const [k, v] of Object.entries(carrier)) headers.set(k, v);
}

/**
 * Start a server span for an incoming HTTP request
 */
export function startServerSpan(
  method: string,
  path: string,
  parentContext?: unknown,
): { span: unknown; context: unknown } | null {
  if (!traceApi || !isOTLPEnabled()) return null;

  const tracingConfig = getOtelTracingConfig();
  const serviceName = tracingConfig.serviceName || "veryfront-renderer";
  const tracer = traceApi.trace.getTracer(serviceName);
  const ctx = (parentContext || traceApi.context.active()) as import("@opentelemetry/api").Context;

  const span = tracer.startSpan(`${method} ${path}`, { kind: traceApi.SpanKind.SERVER }, ctx);
  span.setAttribute("http.method", method);
  span.setAttribute("http.target", path);

  return { span, context: traceApi.trace.setSpan(ctx, span) };
}

/**
 * End a span with status code and optional error
 */
export function endServerSpan(span: unknown, statusCode: number, error?: Error): void {
  if (!span || !traceApi) return;

  const s = span as import("@opentelemetry/api").Span;
  s.setAttribute("http.status_code", statusCode);

  if (error) {
    s.setStatus({ code: traceApi.SpanStatusCode.ERROR, message: error.message });
    s.recordException(error);
  } else if (statusCode >= 400) {
    s.setStatus({ code: traceApi.SpanStatusCode.ERROR });
  } else {
    s.setStatus({ code: traceApi.SpanStatusCode.OK });
  }

  s.end();
}

/**
 * Set attributes on a span
 */
export function setSpanAttributes(
  span: unknown,
  attributes: Record<string, string | number | boolean>,
): void {
  if (!span || !traceApi) return;

  const s = span as import("@opentelemetry/api").Span;
  for (const [key, value] of Object.entries(attributes)) s.setAttribute(key, value);
}

/**
 * Set attributes on the currently active span (if any).
 * Useful for adding response metadata inside withSpan callbacks.
 */
export function setActiveSpanAttributes(
  attributes: Record<string, string | number | boolean>,
): void {
  if (!traceApi) return;

  const span = traceApi.trace.getSpan(traceApi.context.active());
  if (!span) return;

  for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
}

/**
 * Execute a function within a span context
 */
export async function withContext<T>(spanContext: unknown, fn: () => Promise<T>): Promise<T> {
  if (!traceApi) return await fn();
  return await traceApi.context.with(spanContext as import("@opentelemetry/api").Context, fn);
}

/**
 * Get current trace context info (for logging correlation)
 */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  if (!traceApi) return {};

  const span = traceApi.trace.getSpan(traceApi.context.active());
  if (!span) return {};

  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

/**
 * Initialize OTLP with API loading for span creation
 */
export async function initializeOTLPWithApis(): Promise<void> {
  await initializeOTLP();
  if (isOTLPEnabled()) await ensureApis();
}
