/**************************
 * OpenTelemetry OTLP Setup
 *
 * Thin wrapper that delegates to the `ext-observability-opentelemetry` extension via the
 * `TracingExporter` contract.  When the extension is not installed, all span
 * operations silently no-op.
 *
 * Reads configuration from environment variables:
 * - OTEL_TRACES_ENABLED: "true" to enable tracing
 * - OTEL_SERVICE_NAME: Service name for traces
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint
 * - OTEL_EXPORTER_OTLP_HEADERS: Auth headers
 **************************/

import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { serverLogger } from "#veryfront/utils";
import {
  type AttributeValue,
  type Context,
  context as shimContext,
  defaultTextMapGetter,
  defaultTextMapSetter,
  getTracer,
  getTracerProviderRevision,
  propagation as shimPropagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace as shimTrace,
  type Tracer,
} from "./api-shim.ts";
import { getHostTelemetryEnv } from "./telemetry-env.ts";

const logger = serverLogger.component("otel");

/** Configuration used by otlpconfig. */
export interface OTLPConfig {
  serviceName: string;
  endpoint: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

function parseHeaders(headerString: string | undefined): Record<string, string> {
  if (!headerString) return {};

  if (headerString.startsWith("Basic ")) return { Authorization: headerString };

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
  // Span helpers can run during module initialization and test setup, before
  // bootstrap has loaded .env files. Read tracing env directly here so no-op
  // spans do not force early EnvironmentConfig initialization.
  return {
    enabled: isTruthyEnvValue(getHostTelemetryEnv("VERYFRONT_OTEL")) ||
      isTruthyEnvValue(getHostTelemetryEnv("OTEL_TRACES_ENABLED")),
    serviceName: getHostTelemetryEnv("OTEL_SERVICE_NAME") || "veryfront",
    endpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || "",
    headers: parseHeaders(getHostTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS")),
  };
}

let cachedTracingRuntime:
  | {
    providerRevision: number;
    config: OTLPConfig;
    tracer: Tracer;
  }
  | undefined;

function getTracingRuntime(): { config: OTLPConfig; tracer: Tracer } {
  const providerRevision = getTracerProviderRevision();
  if (!cachedTracingRuntime || cachedTracingRuntime.providerRevision !== providerRevision) {
    const config = getConfig();
    cachedTracingRuntime = {
      providerRevision,
      config,
      tracer: getTracer(config.serviceName),
    };
  }

  return cachedTracingRuntime;
}

// ---------------------------------------------------------------------------
// Legacy initialise / shutdown (now delegated to bootstrap.ts + ext)
// ---------------------------------------------------------------------------

let initialized = false;

/** Initialize OTLP tracing export. */
export async function initializeOTLP(): Promise<void> {
  if (initialized) {
    logger.debug("Already initialized");
    return;
  }
  // Actual provider setup is handled by ext-observability-opentelemetry via bootstrap.
  // This is kept for backward compatibility.
  initialized = true;
  logger.debug("OTLP setup delegated to ext-observability-opentelemetry extension");
}

/** Shut down OTLP tracing export. */
export async function shutdownOTLP(): Promise<void> {
  // Actual shutdown is handled by the extension loader teardown.
  logger.debug("OTLP shutdown delegated to ext-observability-opentelemetry extension");
}

/** Check whether OTLP export is enabled. */
export function isOTLPEnabled(): boolean {
  return initialized;
}

/** Initialize OTLP tracing with explicit API adapters. */
export async function initializeOTLPWithApis(): Promise<void> {
  await initializeOTLP();
}

// ---------------------------------------------------------------------------
// Span helpers — delegate to shim (which delegates to SDK if wired)
// ---------------------------------------------------------------------------

function setSpanErrorStatus(span: Span, error: unknown): void {
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
  if (error instanceof Error) span.recordException(error);
}

export type WithSpanOptions = {
  kind?: SpanKind;
};

/** Applies span. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, AttributeValue>,
  options?: WithSpanOptions,
): Promise<T> {
  const { tracer } = getTracingRuntime();
  const parentContext = shimContext.active();

  const span = tracer.startSpan(
    name,
    { kind: options?.kind ?? SpanKind.INTERNAL, attributes },
    parentContext,
  );

  const spanContext = shimTrace.setSpan(parentContext, span);

  try {
    const result = await shimContext.with(spanContext, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    setSpanErrorStatus(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/** Applies span sync. */
export function withSpanSync<T>(
  name: string,
  fn: () => T,
  attributes?: Record<string, AttributeValue>,
  options?: WithSpanOptions,
): T {
  const { tracer } = getTracingRuntime();
  const parentContext = shimContext.active();

  const span = tracer.startSpan(
    name,
    { kind: options?.kind ?? SpanKind.INTERNAL, attributes },
    parentContext,
  );

  try {
    const result = fn();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    setSpanErrorStatus(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/** Context for extract. */
export function extractContext(headers: Headers): Context | undefined {
  const carrier: Record<string, string> = {};
  for (const [k, v] of headers) carrier[k.toLowerCase()] = v;

  return shimPropagation.extract(shimContext.active(), carrier, defaultTextMapGetter);
}

/** Context for inject. */
export function injectContext(headers: Headers): void {
  const carrier: Record<string, string> = {};
  shimPropagation.inject(shimContext.active(), carrier, defaultTextMapSetter);
  for (const [k, v] of Object.entries(carrier)) headers.set(k, v);
}

/** Starts server span. */
export function startServerSpan(
  method: string,
  path: string,
  parentContext?: unknown,
): { span: Span; context: Context } | null {
  const { tracer } = getTracingRuntime();
  const ctx = (parentContext || shimContext.active()) as Context;

  const span = tracer.startSpan(`${method} ${path}`, { kind: SpanKind.SERVER }, ctx);
  span.setAttribute("http.method", method);
  span.setAttribute("http.target", path);

  return { span, context: shimTrace.setSpan(ctx, span) };
}

/** End an active server tracing span. */
export function endServerSpan(span: unknown, statusCode: number, error?: Error): void {
  if (!span) return;

  const otelSpan = span as Span;
  otelSpan.setAttribute("http.status_code", statusCode);

  if (error) {
    setSpanErrorStatus(otelSpan, error);
    otelSpan.end();
    return;
  }

  if (statusCode >= 400) {
    otelSpan.setStatus({ code: SpanStatusCode.ERROR });
    otelSpan.end();
    return;
  }

  otelSpan.setStatus({ code: SpanStatusCode.OK });
  otelSpan.end();
}

/** Sets span attributes. */
export function setSpanAttributes(
  span: unknown,
  attributes: Record<string, AttributeValue>,
): void {
  if (!span) return;

  const otelSpan = span as Span;
  for (const [key, value] of Object.entries(attributes)) otelSpan.setAttribute(key, value);
}

/** Adds an event to a span. */
export function addSpanEvent(
  span: unknown,
  name: string,
  attributes?: Record<string, AttributeValue>,
): void {
  if (!span) return;

  const otelSpan = span as Span;
  otelSpan.addEvent(name, attributes);
}

/** Sets active span attributes. */
export function setActiveSpanAttributes(
  attributes: Record<string, AttributeValue>,
): void {
  const span = shimTrace.getActiveSpan?.();
  if (!span) return;

  for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
}

/** Context for with. */
export async function withContext<T>(spanContext: unknown, fn: () => Promise<T>): Promise<T> {
  return shimContext.with(spanContext as Context, fn);
}

/** Context for get trace. */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = shimTrace.getActiveSpan?.();
  if (!span) return {};

  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}
