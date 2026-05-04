/****
 * OpenTelemetry OTLP tracing for proxy.
 *
 * Uses the core api-shim for in-process tracing; when ext-opentelemetry
 * is loaded, the shim delegates to the real SDK provider.
 *
 * Env: OTEL_TRACES_ENABLED, OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT,
 *      OTEL_EXPORTER_OTLP_HEADERS
 */

import {
  type Context,
  context as shimContext,
  defaultTextMapGetter,
  defaultTextMapSetter,
  propagation as shimPropagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace as shimTrace,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getEnv } from "./env.ts";
import { proxyLogger } from "./logger.ts";

let initialized = false;
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

function getConfig(): OTLPConfig {
  return {
    enabled: getEnv("OTEL_TRACES_ENABLED") === "true",
    serviceName: getEnv("OTEL_SERVICE_NAME") || "veryfront-proxy",
    endpoint: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || "",
    headers: parseHeaders(getEnv("OTEL_EXPORTER_OTLP_HEADERS")),
  };
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
    // The shim's provider is wired by ext-opentelemetry via bootstrap.ts.
    // We simply get a tracer from the shim — it delegates to the real SDK
    // when the extension is active, otherwise returns the no-op tracer.
    tracer = shimTrace.getTracer(config.serviceName);
    initialized = true;

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
  proxyLogger.info("[otel] Shutdown complete");
}

export function extractContext(headers: Headers): Context | undefined {
  const carrier: Record<string, string> = {};
  headers.forEach((v, k) => {
    carrier[k.toLowerCase()] = v;
  });

  const extracted = shimPropagation.extract(shimContext.active(), carrier, defaultTextMapGetter);
  return extracted;
}

export function injectContext(headers: Headers): void {
  const carrier: Record<string, string> = {};
  shimPropagation.inject(shimContext.active(), carrier, defaultTextMapSetter);

  for (const [k, v] of Object.entries(carrier)) {
    headers.set(k, v);
  }
}

export function startServerSpan(
  method: string,
  path: string,
  parentContext?: Context,
): { span: Span; context: Context } | null {
  if (!tracer) return null;

  const ctx = parentContext ?? shimContext.active();
  const span = tracer.startSpan(`${method} ${path}`, { kind: SpanKind.SERVER }, ctx);
  return { span, context: shimTrace.setSpan(ctx, span) };
}

export function endSpan(span: Span | undefined, statusCode: number, error?: Error): void {
  if (!span) return;

  span.setAttribute("http.status_code", statusCode);

  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    span.end();
    return;
  }

  if (statusCode >= 400) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

export function withContext<T>(spanContext: Context, fn: () => Promise<T>): Promise<T> {
  return shimContext.with(spanContext, fn);
}

function getActiveSpanContext(): { traceId: string; spanId: string } | null {
  const activeSpan = shimTrace.getActiveSpan?.();
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
  if (!tracer) return await fn();

  const parentContext = shimContext.active();
  const span = tracer.startSpan(
    name,
    { kind: SpanKind.INTERNAL, attributes },
    parentContext,
  );

  const spanContext = shimTrace.setSpan(parentContext, span);

  try {
    const result = await shimContext.with(spanContext, fn);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
