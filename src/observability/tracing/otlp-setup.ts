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

import { serverLogger as logger } from "@veryfront/utils";

let initialized = false;
let tracerProvider: unknown = null;

export interface OTLPConfig {
  serviceName: string;
  endpoint: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

function parseHeaders(headerString: string | undefined): Record<string, string> {
  if (!headerString) return {};

  const headers: Record<string, string> = {};
  // Headers are comma-separated key=value pairs
  const parts = headerString.split(",");
  for (const part of parts) {
    const [key, ...valueParts] = part.split("=");
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join("=").trim();
    }
  }
  return headers;
}

function getConfig(): OTLPConfig {
  const enabled = Deno.env.get("OTEL_TRACES_ENABLED") === "true";
  const serviceName = Deno.env.get("OTEL_SERVICE_NAME") || "veryfront";
  const endpoint = Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") || "";
  const headerString = Deno.env.get("OTEL_EXPORTER_OTLP_HEADERS");
  const headers = parseHeaders(headerString);

  return { enabled, serviceName, endpoint, headers };
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
    // Dynamic imports for tree-shaking when disabled
    const { trace } = await import("@opentelemetry/api");
    const { BasicTracerProvider, BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

    // Create resource with service name
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
    });

    // Create OTLP exporter
    const exporter = new OTLPTraceExporter({
      url: `${config.endpoint}/v1/traces`,
      headers: config.headers,
    });

    // Create and configure tracer provider
    const provider = new BasicTracerProvider({ resource });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));

    // Register as global tracer provider
    provider.register();
    tracerProvider = provider;

    initialized = true;
    logger.info("[otel] OpenTelemetry OTLP tracing initialized", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });

    // Get a tracer for verification
    const _tracer = trace.getTracer(config.serviceName);
    logger.debug("[otel] Tracer obtained", { name: config.serviceName });
  } catch (error) {
    logger.error("[otel] Failed to initialize OTLP tracing", { error });
    initialized = true; // Mark as initialized to prevent retries
  }
}

export async function shutdownOTLP(): Promise<void> {
  if (tracerProvider && typeof (tracerProvider as any).shutdown === "function") {
    try {
      await (tracerProvider as any).shutdown();
      logger.info("[otel] Tracer provider shutdown complete");
    } catch (error) {
      logger.warn("[otel] Error during tracer shutdown", { error });
    }
  }
}

export function isOTLPEnabled(): boolean {
  return initialized && tracerProvider !== null;
}

// Lazy-loaded OpenTelemetry API references
let traceApi: typeof import("@opentelemetry/api") | null = null;
let propagationApi: typeof import("@opentelemetry/core") | null = null;

async function ensureApis(): Promise<void> {
  if (!traceApi) {
    traceApi = await import("@opentelemetry/api");
    propagationApi = await import("@opentelemetry/core");
  }
}

/**
 * Extract trace context from incoming request headers
 */
export function extractContext(headers: Headers): unknown {
  if (!traceApi || !propagationApi) return traceApi?.context?.active();
  const carrier: Record<string, string> = {};
  headers.forEach((v, k) => (carrier[k.toLowerCase()] = v));
  return propagationApi.W3CTraceContextPropagator
    ? new propagationApi.W3CTraceContextPropagator().extract(
      traceApi.context.active(),
      carrier,
      traceApi.defaultTextMapGetter,
    )
    : traceApi.context.active();
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
  Object.entries(carrier).forEach(([k, v]) => headers.set(k, v));
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
  const serviceName = Deno.env.get("OTEL_SERVICE_NAME") || "veryfront-renderer";
  const tracer = traceApi.trace.getTracer(serviceName);
  const ctx = (parentContext || traceApi.context.active()) as import("@opentelemetry/api").Context;
  const span = tracer.startSpan(`${method} ${path}`, { kind: traceApi.SpanKind.SERVER }, ctx);
  // Set initial HTTP attributes
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
  for (const [key, value] of Object.entries(attributes)) {
    s.setAttribute(key, value);
  }
}

/**
 * Execute a function within a span context
 */
export async function withContext<T>(spanContext: unknown, fn: () => Promise<T>): Promise<T> {
  if (!traceApi) return fn();
  return traceApi.context.with(spanContext as import("@opentelemetry/api").Context, fn);
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

// Initialize APIs when OTLP initializes
const originalInit = initializeOTLP;

/**
 * Initialize OTLP with API loading for span creation
 */
export async function initializeOTLPWithApis(): Promise<void> {
  await originalInit();
  if (isOTLPEnabled()) await ensureApis();
}
