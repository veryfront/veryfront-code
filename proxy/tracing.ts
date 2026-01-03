/**
 * OpenTelemetry OTLP Setup for Proxy
 *
 * Configures the OTLP exporter to send traces to Grafana Cloud.
 * Reads configuration from environment variables:
 * - OTEL_TRACES_ENABLED: "true" to enable tracing
 * - OTEL_SERVICE_NAME: Service name for traces
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint
 * - OTEL_EXPORTER_OTLP_HEADERS: Auth headers (comma-separated key=value)
 */

let initialized = false;
let tracerProvider: unknown = null;

interface OTLPConfig {
  serviceName: string;
  endpoint: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

function parseHeaders(headerString: string | undefined): Record<string, string> {
  if (!headerString) return {};

  const headers: Record<string, string> = {};
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
  const serviceName = Deno.env.get("OTEL_SERVICE_NAME") || "veryfront-proxy";
  const endpoint = Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") || "";
  const headerString = Deno.env.get("OTEL_EXPORTER_OTLP_HEADERS");
  const headers = parseHeaders(headerString);

  return { enabled, serviceName, endpoint, headers };
}

export async function initializeOTLP(): Promise<void> {
  if (initialized) {
    console.log("[otel] Already initialized");
    return;
  }

  const config = getConfig();

  if (!config.enabled) {
    console.log("[otel] Tracing disabled (OTEL_TRACES_ENABLED != true)");
    initialized = true;
    return;
  }

  if (!config.endpoint) {
    console.warn("[otel] No OTEL_EXPORTER_OTLP_ENDPOINT configured, skipping");
    initialized = true;
    return;
  }

  try {
    // Dynamic imports using explicit npm: specifiers for proxy container
    const { trace } = await import("npm:@opentelemetry/api@1");
    const { BasicTracerProvider, BatchSpanProcessor } = await import(
      "npm:@opentelemetry/sdk-trace-base@1"
    );
    const { OTLPTraceExporter } = await import("npm:@opentelemetry/exporter-trace-otlp-http@0.57");
    const { Resource } = await import("npm:@opentelemetry/resources@1");
    const { ATTR_SERVICE_NAME } = await import("npm:@opentelemetry/semantic-conventions@1");

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
    console.log("[otel] OpenTelemetry OTLP tracing initialized", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });

    // Get a tracer for verification (unused, but confirms setup)
    trace.getTracer(config.serviceName);
  } catch (error) {
    console.error("[otel] Failed to initialize OTLP tracing", { error });
    initialized = true; // Mark as initialized to prevent retries
  }
}

export async function shutdownOTLP(): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const provider = tracerProvider as any;
  if (provider && typeof provider.shutdown === "function") {
    try {
      await provider.shutdown();
      console.log("[otel] Tracer provider shutdown complete");
    } catch (error) {
      console.warn("[otel] Error during tracer shutdown", { error });
    }
  }
}

export function isOTLPEnabled(): boolean {
  return initialized && tracerProvider !== null;
}

let traceApi: typeof import("npm:@opentelemetry/api@1") | null = null;
let propagationApi: typeof import("npm:@opentelemetry/core@1") | null = null;

async function ensureApis() {
  if (!traceApi) {
    traceApi = await import("npm:@opentelemetry/api@1");
    propagationApi = await import("npm:@opentelemetry/core@1");
  }
}

export function extractContext(headers: Headers): unknown {
  if (!traceApi || !propagationApi) return traceApi?.context?.active();
  const carrier: Record<string, string> = {};
  headers.forEach((v, k) => (carrier[k.toLowerCase()] = v));
  return propagationApi.W3CTraceContextPropagator
    ? new propagationApi.W3CTraceContextPropagator().extract(
        traceApi.context.active(),
        carrier,
        traceApi.defaultTextMapGetter
      )
    : traceApi.context.active();
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
  parentContext?: unknown
): { span: unknown; context: unknown } | null {
  if (!traceApi || !isOTLPEnabled()) return null;
  const tracer = traceApi.trace.getTracer("veryfront-proxy");
  const ctx = (parentContext || traceApi.context.active()) as import("npm:@opentelemetry/api@1").Context;
  const span = tracer.startSpan(`${method} ${path}`, { kind: traceApi.SpanKind.SERVER }, ctx);
  return { span, context: traceApi.trace.setSpan(ctx, span) };
}

export function endSpan(span: unknown, statusCode: number, error?: Error): void {
  if (!span || !traceApi) return;
  const s = span as import("npm:@opentelemetry/api@1").Span;
  s.setAttribute("http.status_code", statusCode);
  if (error) {
    s.setStatus({ code: traceApi.SpanStatusCode.ERROR, message: error.message });
    s.recordException(error);
  } else if (statusCode >= 400) {
    s.setStatus({ code: traceApi.SpanStatusCode.ERROR });
  }
  s.end();
}

export async function withContext<T>(spanContext: unknown, fn: () => Promise<T>): Promise<T> {
  if (!traceApi) return fn();
  return traceApi.context.with(spanContext as import("npm:@opentelemetry/api@1").Context, fn);
}

export function getTraceContext(): { traceId?: string; spanId?: string } {
  if (!traceApi) return {};
  const span = traceApi.trace.getSpan(traceApi.context.active());
  if (!span) return {};
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

// Initialize APIs when OTLP initializes
const originalInit = initializeOTLP;
export async function initializeOTLPWithApis(): Promise<void> {
  await originalInit();
  if (isOTLPEnabled()) await ensureApis();
}
