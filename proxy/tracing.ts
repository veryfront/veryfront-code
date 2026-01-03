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
