/**
 * OpenTelemetry OTLP tracing for proxy.
 * Env: OTEL_TRACES_ENABLED, OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
 */

import type {
  Context,
  Span,
  Tracer,
} from "@opentelemetry/api";

let initialized = false;
let tracerProvider: { shutdown: () => Promise<void> } | null = null;
let tracer: Tracer | null = null;

interface OTLPConfig {
  serviceName: string;
  endpoint: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

function parseHeaders(headerString: string | undefined): Record<string, string> {
  if (!headerString) return {};
  const headers: Record<string, string> = {};
  for (const part of headerString.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join("=").trim();
    }
  }
  return headers;
}

function getConfig(): OTLPConfig {
  return {
    enabled: Deno.env.get("OTEL_TRACES_ENABLED") === "true",
    serviceName: Deno.env.get("OTEL_SERVICE_NAME") || "veryfront-proxy",
    endpoint: Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") || "",
    headers: parseHeaders(Deno.env.get("OTEL_EXPORTER_OTLP_HEADERS")),
  };
}

let traceApi: typeof import("@opentelemetry/api") | null = null;
let propagationApi: typeof import("@opentelemetry/core") | null = null;

async function loadApis(): Promise<void> {
  if (traceApi) return;
  traceApi = await import("@opentelemetry/api");
  propagationApi = await import("@opentelemetry/core");
}

export async function initializeOTLP(): Promise<void> {
  if (initialized) return;

  const config = getConfig();

  if (!config.enabled) {
    initialized = true;
    return;
  }

  if (!config.endpoint) {
    console.warn("[otel] No endpoint configured");
    initialized = true;
    return;
  }

  try {
    const { trace } = await import("@opentelemetry/api");
    const { BasicTracerProvider, BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

    const resource = new Resource({ [ATTR_SERVICE_NAME]: config.serviceName });
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

    console.log("[otel] Initialized", { serviceName: config.serviceName, endpoint: config.endpoint });
  } catch (error) {
    console.error("[otel] Init failed", { error });
    initialized = true;
  }
}

export async function shutdownOTLP(): Promise<void> {
  if (tracerProvider) {
    try {
      await tracerProvider.shutdown();
      console.log("[otel] Shutdown complete");
    } catch (error) {
      console.warn("[otel] Shutdown error", { error });
    }
  }
}

export function isOTLPEnabled(): boolean {
  return initialized && tracerProvider !== null;
}

export function extractContext(headers: Headers): Context | undefined {
  if (!traceApi || !propagationApi) return undefined;
  const carrier: Record<string, string> = {};
  headers.forEach((v, k) => (carrier[k.toLowerCase()] = v));
  return new propagationApi.W3CTraceContextPropagator().extract(
    traceApi.context.active(),
    carrier,
    traceApi.defaultTextMapGetter
  );
}

export function injectContext(headers: Headers): void {
  if (!traceApi || !propagationApi) return;
  const carrier: Record<string, string> = {};
  new propagationApi.W3CTraceContextPropagator().inject(
    traceApi.context.active(),
    carrier,
    traceApi.defaultTextMapSetter
  );
  Object.entries(carrier).forEach(([k, v]) => headers.set(k, v));
}

export function startServerSpan(
  method: string,
  path: string,
  parentContext?: Context
): { span: Span; context: Context } | null {
  if (!traceApi || !tracer) return null;
  const ctx = parentContext || traceApi.context.active();
  const span = tracer.startSpan(`${method} ${path}`, { kind: traceApi.SpanKind.SERVER }, ctx);
  return { span, context: traceApi.trace.setSpan(ctx, span) };
}

export function endSpan(span: Span | undefined, statusCode: number, error?: Error): void {
  if (!span || !traceApi) return;
  span.setAttribute("http.status_code", statusCode);
  if (error) {
    span.setStatus({ code: traceApi.SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
  } else if (statusCode >= 400) {
    span.setStatus({ code: traceApi.SpanStatusCode.ERROR });
  }
  span.end();
}

export function withContext<T>(spanContext: Context, fn: () => Promise<T>): Promise<T> {
  if (!traceApi) return fn();
  return traceApi.context.with(spanContext, fn);
}

export function getTraceContext(): { traceId?: string; spanId?: string } {
  if (!traceApi) return {};
  const span = traceApi.trace.getSpan(traceApi.context.active());
  if (!span) return {};
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

export { initializeOTLP as initializeOTLPWithApis };
