/****
 * OpenTelemetry OTLP tracing for proxy.
 * Env: OTEL_TRACES_ENABLED, OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
 */

import type { Context, Span, Tracer } from "@opentelemetry/api";
import denoConfig from "#deno-config" with { type: "json" };
import { getEnv } from "./env.ts";
import { proxyLogger } from "./logger.ts";

// Get version from environment variable or root deno.json
const VERYFRONT_VERSION: string = getEnv("VERYFRONT_VERSION") ??
  (typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0");

let initialized = false;
let tracerProvider: { shutdown: () => Promise<void> } | null = null;
let tracer: Tracer | null = null;

interface OTLPConfig {
  serviceName: string;
  endpoint: string;
  headers: Record<string, string>;
  enabled: boolean;
}

function parseHeaders(headerString: string | undefined): Record<string, string> {
  if (!headerString) return {};

  const headers: Record<string, string> = {};
  for (const part of headerString.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (!key || valueParts.length === 0) continue;
    headers[key.trim()] = valueParts.join("=").trim();
  }
  return headers;
}

/**
 * Parse OTEL_RESOURCE_ATTRIBUTES env var (key=value,key2=value2 format).
 */
function parseResourceAttributes(attrString: string | undefined): Record<string, string> {
  if (!attrString) return {};
  const attrs: Record<string, string> = {};
  for (const part of attrString.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (key && valueParts.length > 0) {
      attrs[key.trim()] = valueParts.join("=").trim();
    }
  }
  return attrs;
}

function getConfig(): OTLPConfig {
  return {
    enabled: getEnv("OTEL_TRACES_ENABLED") === "true",
    serviceName: getEnv("OTEL_SERVICE_NAME") || "veryfront-proxy",
    endpoint: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || "",
    headers: parseHeaders(getEnv("OTEL_EXPORTER_OTLP_HEADERS")),
  };
}

let traceApi: typeof import("@opentelemetry/api") | null = null;
let propagationApi: typeof import("@opentelemetry/core") | null = null;

async function loadApis(): Promise<void> {
  if (traceApi) return;
  traceApi = await import("@opentelemetry/api");
  propagationApi = await import("@opentelemetry/core");
}

export async function initializeOTLPWithApis(): Promise<void> {
  if (initialized) return;

  const config = getConfig();

  if (!config.enabled) {
    initialized = true;
    return;
  }

  if (!config.endpoint) {
    proxyLogger.warn("[otel] No endpoint configured");
    initialized = true;
    return;
  }

  try {
    const { trace } = await import("@opentelemetry/api");
    const { BasicTracerProvider, BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
      "@opentelemetry/semantic-conventions"
    );

    const resourceAttrs = parseResourceAttributes(getEnv("OTEL_RESOURCE_ATTRIBUTES"));
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: VERYFRONT_VERSION,
      ...resourceAttrs,
    });

    const exporter = new OTLPTraceExporter({
      url: `${config.endpoint}/v1/traces`,
      headers: config.headers,
    });

    const provider = new BasicTracerProvider({ resource });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider.register();

    tracerProvider = provider;
    tracer = trace.getTracer(config.serviceName);
    initialized = true;

    await loadApis();

    proxyLogger.info("[otel] Initialized", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });
  } catch (error) {
    proxyLogger.error("[otel] Init failed", error);
    initialized = true;
  }
}

export async function shutdownOTLP(): Promise<void> {
  if (!tracerProvider) return;

  try {
    await tracerProvider.shutdown();
    proxyLogger.info("[otel] Shutdown complete");
  } catch (error) {
    proxyLogger.error("[otel] Shutdown error", error);
  }
}

function getPropagator(): import("@opentelemetry/core").W3CTraceContextPropagator | null {
  if (!propagationApi) return null;
  return new propagationApi.W3CTraceContextPropagator();
}

export function extractContext(headers: Headers): Context | undefined {
  if (!traceApi) return undefined;

  const propagator = getPropagator();
  if (!propagator) return undefined;

  const carrier: Record<string, string> = {};
  headers.forEach((v, k) => {
    carrier[k.toLowerCase()] = v;
  });

  return propagator.extract(
    traceApi.context.active(),
    carrier,
    traceApi.defaultTextMapGetter,
  );
}

export function injectContext(headers: Headers): void {
  if (!traceApi) return;

  const propagator = getPropagator();
  if (!propagator) return;

  const carrier: Record<string, string> = {};
  propagator.inject(
    traceApi.context.active(),
    carrier,
    traceApi.defaultTextMapSetter,
  );

  for (const [k, v] of Object.entries(carrier)) {
    headers.set(k, v);
  }
}

export function startServerSpan(
  method: string,
  path: string,
  parentContext?: Context,
): { span: Span; context: Context } | null {
  if (!traceApi || !tracer) return null;

  const ctx = parentContext ?? traceApi.context.active();
  const span = tracer.startSpan(`${method} ${path}`, { kind: traceApi.SpanKind.SERVER }, ctx);
  return { span, context: traceApi.trace.setSpan(ctx, span) };
}

export function endSpan(span: Span | undefined, statusCode: number, error?: Error): void {
  if (!span || !traceApi) return;

  span.setAttribute("http.status_code", statusCode);

  if (error) {
    span.setStatus({ code: traceApi.SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    span.end();
    return;
  }

  if (statusCode >= 400) {
    span.setStatus({ code: traceApi.SpanStatusCode.ERROR });
  }

  span.end();
}

export function withContext<T>(spanContext: Context, fn: () => Promise<T>): Promise<T> {
  if (!traceApi) return fn();
  return traceApi.context.with(spanContext, fn);
}

function getActiveSpanContext():
  | import("@opentelemetry/api").SpanContext
  | null {
  if (!traceApi) return null;

  const activeSpan = traceApi.trace.getSpan(traceApi.context.active());
  return activeSpan ? activeSpan.spanContext() : null;
}

export function getTraceContext(): { traceId?: string; spanId?: string } {
  const spanContext = getActiveSpanContext();
  if (!spanContext) return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

/**
 * Span names for proxy tracing.
 */
export const ProxySpanNames = {
  PROXY_TOKEN_FETCH: "proxy.token_fetch",
  PROXY_DOMAIN_LOOKUP: "proxy.domain_lookup",
  OAUTH_TOKEN_REQUEST: "oauth.token_request",
  HTTP_CLIENT_FETCH: "http.client.fetch",
} as const;

/**
 * Execute an async function within a tracing span.
 * If tracing is disabled, executes the function directly.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!traceApi || !tracer) return await fn();

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
