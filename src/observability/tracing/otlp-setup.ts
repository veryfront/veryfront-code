/**
 * Legacy OTLP helpers backed by the global OpenTelemetry extension.
 *
 * Span callbacks still run when the extension is absent, but span operations
 * become no-ops. Exporter configuration comes from the host telemetry
 * environment.
 *
 * @module observability/otlp-setup
 */

import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
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
import {
  normalizeHttpMethod,
  normalizeRouteTemplate,
  normalizeTelemetryName,
  runSpanHook,
  sanitizeTelemetryAttributes,
  setSanitizedSpanError,
} from "../telemetry-safety.ts";

const logger = serverLogger.component("otel");
const TRACE_CONTEXT_HEADERS = new Set(["traceparent", "tracestate"]);
const MAX_TRACE_CONTEXT_VALUE_LENGTH = 8_192;
const MAX_OTLP_HEADERS = 32;
const MAX_OTLP_HEADER_VALUE_LENGTH = 4_096;
const SAFE_HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;

/** Host-owned OTLP configuration snapshot. */
export interface OTLPConfig {
  /** Service name attached to emitted telemetry. */
  serviceName: string;
  /** OTLP collector endpoint. */
  endpoint: string;
  /** Bounded exporter headers parsed from host configuration. */
  headers?: Record<string, string>;
  /** Whether host configuration enables OTLP tracing. */
  enabled: boolean;
}

function parseHeaders(headerString: string | undefined): Record<string, string> {
  const headers = Object.create(null) as Record<string, string>;
  if (!headerString || headerString.length > 16_384) return headers;

  if (headerString.startsWith("Basic ")) {
    if (headerString.length <= MAX_OTLP_HEADER_VALUE_LENGTH && !/[\r\n]/.test(headerString)) {
      headers.Authorization = headerString;
    }
    return headers;
  }

  if (headerString.startsWith("Authorization=")) {
    const value = headerString.substring("Authorization=".length);
    if (value.length <= MAX_OTLP_HEADER_VALUE_LENGTH && !/[\r\n]/.test(value)) {
      headers.Authorization = value;
    }
    return headers;
  }

  let count = 0;
  for (const part of headerString.split(",")) {
    if (count >= MAX_OTLP_HEADERS) break;
    const [key, ...valueParts] = part.split("=");
    if (!key || valueParts.length === 0) continue;
    const normalizedKey = key.trim();
    const value = valueParts.join("=").trim();
    if (
      !SAFE_HEADER_NAME.test(normalizedKey) || value.length > MAX_OTLP_HEADER_VALUE_LENGTH ||
      /[\r\n]/.test(value)
    ) {
      continue;
    }
    Object.defineProperty(headers, normalizedKey, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    count++;
  }
  return headers;
}

function getConfig(): OTLPConfig {
  // Span helpers can run during module initialization and test setup, before
  // bootstrap has loaded .env files. Read tracing env directly here so no-op
  // spans do not force early EnvironmentConfig initialization.
  const endpoint = getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  return {
    enabled: isTruthyEnvValue(getHostTelemetryEnv("VERYFRONT_OTEL")) ||
      isTruthyEnvValue(getHostTelemetryEnv("OTEL_TRACES_ENABLED")),
    serviceName: normalizeTelemetryName(getHostTelemetryEnv("OTEL_SERVICE_NAME") || "veryfront"),
    endpoint: typeof endpoint === "string" && endpoint.length <= 2_048 && !/[\r\n]/.test(endpoint)
      ? endpoint
      : "",
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

function safeLogDebug(message: string): void {
  try {
    logger.debug(message);
  } catch {
    // Telemetry logging must not affect application execution.
  }
}

/** Mark the legacy OTLP lifecycle as initialized. */
export async function initializeOTLP(): Promise<void> {
  if (initialized) {
    safeLogDebug("Already initialized");
    return;
  }
  // Actual provider setup is handled by ext-observability-opentelemetry via bootstrap.
  // This is kept for backward compatibility.
  initialized = true;
  safeLogDebug("OTLP setup delegated to ext-observability-opentelemetry extension");
}

/** Reset the legacy OTLP lifecycle and cached tracer. */
export async function shutdownOTLP(): Promise<void> {
  // Actual shutdown is handled by the extension loader teardown.
  initialized = false;
  cachedTracingRuntime = undefined;
  safeLogDebug("OTLP shutdown delegated to ext-observability-opentelemetry extension");
}

/** Check whether the legacy OTLP lifecycle is initialized. */
export function isOTLPEnabled(): boolean {
  return initialized;
}

/** Initialize the legacy OTLP lifecycle. */
export async function initializeOTLPWithApis(): Promise<void> {
  await initializeOTLP();
}

// ---------------------------------------------------------------------------
// Span helpers delegate to the shim, which delegates to the SDK when wired.
// ---------------------------------------------------------------------------

function setSpanErrorStatus(span: Span, error: unknown): void {
  setSanitizedSpanError(span, SpanStatusCode.ERROR, error);
}

const FALLBACK_SPAN_CONTEXT = {
  traceId: "00000000000000000000000000000000",
  spanId: "0000000000000000",
  traceFlags: 0,
};

const FALLBACK_SPAN: Span = {
  setAttribute: () => FALLBACK_SPAN,
  setAttributes: () => FALLBACK_SPAN,
  setStatus: () => FALLBACK_SPAN,
  recordException: () => {},
  addEvent: () => FALLBACK_SPAN,
  end: () => {},
  spanContext: () => FALLBACK_SPAN_CONTEXT,
  updateName: () => {},
};

type OperationOutcome<T> =
  | { state: "pending" }
  | { state: "resolved"; value: T }
  | { state: "rejected"; error: unknown };

export type WithSpanOptions = {
  kind?: SpanKind;
};

/** Run an asynchronous callback in a bounded span. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, AttributeValue>,
  options?: WithSpanOptions,
): Promise<T> {
  let tracer: Tracer;
  let span: Span;
  let parentContext: Context;

  try {
    ({ tracer } = getTracingRuntime());
    parentContext = shimContext.active();
    span = tracer.startSpan(
      normalizeTelemetryName(name),
      {
        kind: normalizeSpanKind(options?.kind),
        attributes: sanitizeTelemetryAttributes(attributes),
      },
      parentContext,
    );
  } catch {
    return await fn(FALLBACK_SPAN);
  }

  const operationState: { outcome: OperationOutcome<T> } = { outcome: { state: "pending" } };
  let operationPromise: Promise<T> | undefined;
  const invokeOnce = (): Promise<T> => {
    operationPromise ??= (async () => {
      try {
        const value = await fn(span);
        operationState.outcome = { state: "resolved", value };
        return value;
      } catch (error) {
        operationState.outcome = { state: "rejected", error };
        setSpanErrorStatus(span, error);
        throw error;
      }
    })();
    return operationPromise;
  };

  try {
    const spanContext = shimTrace.setSpan(parentContext, span);
    return await shimContext.with(spanContext, invokeOnce);
  } catch {
    if (operationState.outcome.state === "resolved") return operationState.outcome.value;
    if (operationState.outcome.state === "rejected") throw operationState.outcome.error;
    if (operationPromise) return await operationPromise;
    return await invokeOnce();
  } finally {
    runSpanHook(() => span.end());
  }
}

/** Run a synchronous callback in a bounded span. */
export function withSpanSync<T>(
  name: string,
  fn: () => T,
  attributes?: Record<string, AttributeValue>,
  options?: WithSpanOptions,
): T {
  let tracer: Tracer;
  let span: Span;
  let parentContext: Context;

  try {
    ({ tracer } = getTracingRuntime());
    parentContext = shimContext.active();
    span = tracer.startSpan(
      normalizeTelemetryName(name),
      {
        kind: normalizeSpanKind(options?.kind),
        attributes: sanitizeTelemetryAttributes(attributes),
      },
      parentContext,
    );
  } catch {
    return fn();
  }

  const operationState: { outcome: OperationOutcome<T> } = { outcome: { state: "pending" } };
  const invokeOnce = (): T => {
    if (operationState.outcome.state === "resolved") return operationState.outcome.value;
    if (operationState.outcome.state === "rejected") throw operationState.outcome.error;

    try {
      const value = fn();
      operationState.outcome = { state: "resolved", value };
      return value;
    } catch (error) {
      operationState.outcome = { state: "rejected", error };
      setSpanErrorStatus(span, error);
      throw error;
    }
  };

  try {
    const spanContext = shimTrace.setSpan(parentContext, span);
    return shimContext.with(spanContext, invokeOnce);
  } catch {
    if (operationState.outcome.state === "resolved") return operationState.outcome.value;
    if (operationState.outcome.state === "rejected") throw operationState.outcome.error;
    return invokeOnce();
  } finally {
    runSpanHook(() => span.end());
  }
}

/** Extract W3C trace context from bounded propagation headers. */
export function extractContext(headers: Headers): Context | undefined {
  const carrier = Object.create(null) as Record<string, string>;
  for (const key of TRACE_CONTEXT_HEADERS) {
    const value = headers.get(key);
    if (value !== null && value.length <= MAX_TRACE_CONTEXT_VALUE_LENGTH) {
      carrier[key] = value;
    }
  }

  try {
    return shimPropagation.extract(shimContext.active(), carrier, defaultTextMapGetter);
  } catch {
    try {
      return shimContext.active();
    } catch {
      return undefined;
    }
  }
}

/** Inject W3C trace context into response headers. */
export function injectContext(headers: Headers): void {
  try {
    const carrier = Object.create(null) as Record<string, string>;
    shimPropagation.inject(shimContext.active(), carrier, defaultTextMapSetter);
    for (const [key, value] of Object.entries(carrier)) {
      if (
        TRACE_CONTEXT_HEADERS.has(key.toLowerCase()) &&
        typeof value === "string" && value.length <= MAX_TRACE_CONTEXT_VALUE_LENGTH &&
        !/[\r\n]/.test(value)
      ) {
        headers.set(key, value);
      }
    }
  } catch {
    // Propagation is optional and must not affect the request.
  }
}

/** Options for generic server span creation. */
export type StartServerSpanOptions = {
  /** A stable, code-owned route template. Concrete request paths are rejected by contract. */
  routeTemplate?: string;
};

/** Start a server span without recording a concrete request path. */
export function startServerSpan(
  method: string,
  _path: string,
  parentContext?: unknown,
  options: StartServerSpanOptions = {},
): { span: Span; context: Context } | null {
  let span: Span | undefined;
  try {
    const { tracer } = getTracingRuntime();
    const ctx = (parentContext || shimContext.active()) as Context;
    const attributes: Record<string, AttributeValue> = {
      "http.method": normalizeHttpMethod(method),
    };
    const routeTemplate = normalizeRouteTemplate(options.routeTemplate);
    if (routeTemplate) attributes["http.route"] = routeTemplate;

    span = tracer.startSpan(
      "http.server.request",
      { kind: SpanKind.SERVER, attributes },
      ctx,
    );
    return { span, context: shimTrace.setSpan(ctx, span) };
  } catch {
    if (span) runSpanHook(() => span?.end());
    return null;
  }
}

/** End an active server tracing span. */
export function endServerSpan(span: unknown, statusCode: number, error?: unknown): void {
  if (!span) return;

  const otelSpan = span as Span;
  const safeStatusCode = Number.isSafeInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : 0;
  runSpanHook(() => otelSpan.setAttribute("http.status_code", safeStatusCode));

  if (error !== undefined) {
    setSpanErrorStatus(otelSpan, error);
    runSpanHook(() => otelSpan.end());
    return;
  }

  if (safeStatusCode >= 400) {
    runSpanHook(() => otelSpan.setStatus({ code: SpanStatusCode.ERROR }));
    runSpanHook(() => otelSpan.end());
    return;
  }

  if (safeStatusCode === 0) {
    runSpanHook(() => otelSpan.setStatus({ code: SpanStatusCode.UNSET }));
    runSpanHook(() => otelSpan.end());
    return;
  }

  runSpanHook(() => otelSpan.setStatus({ code: SpanStatusCode.OK }));
  runSpanHook(() => otelSpan.end());
}

/** Set bounded, sanitized span attributes. */
export function setSpanAttributes(
  span: unknown,
  attributes: Record<string, AttributeValue>,
): void {
  if (!span) return;

  const otelSpan = span as Span;
  for (const [key, value] of Object.entries(sanitizeTelemetryAttributes(attributes))) {
    runSpanHook(() => otelSpan.setAttribute(key, value));
  }
}

/** Add a bounded, sanitized event to a span. */
export function addSpanEvent(
  span: unknown,
  name: string,
  attributes?: Record<string, AttributeValue>,
): void {
  if (!span) return;

  const otelSpan = span as Span;
  runSpanHook(() =>
    otelSpan.addEvent(
      normalizeTelemetryName(name),
      attributes ? sanitizeTelemetryAttributes(attributes) : undefined,
    )
  );
}

/** Set bounded attributes on the active span. */
export function setActiveSpanAttributes(
  attributes: Record<string, AttributeValue>,
): void {
  try {
    const span = shimTrace.getActiveSpan?.();
    if (!span) return;

    for (const [key, value] of Object.entries(sanitizeTelemetryAttributes(attributes))) {
      runSpanHook(() => span.setAttribute(key, value));
    }
  } catch {
    // Telemetry must not affect application behavior.
  }
}

/** Marks the active span as failed. */
export function setActiveSpanErrorStatus(error: unknown): void {
  try {
    const span = shimTrace.getActiveSpan?.();
    if (!span) return;
    setSpanErrorStatus(span, error);
  } catch {
    // Telemetry must not affect application behavior.
  }
}

/** Run a callback once inside the supplied context. */
export async function withContext<T>(spanContext: unknown, fn: () => Promise<T>): Promise<T> {
  const operationState: { outcome: OperationOutcome<T> } = { outcome: { state: "pending" } };
  let operationPromise: Promise<T> | undefined;
  const invokeOnce = (): Promise<T> => {
    operationPromise ??= (async () => {
      try {
        const value = await fn();
        operationState.outcome = { state: "resolved", value };
        return value;
      } catch (error) {
        operationState.outcome = { state: "rejected", error };
        throw error;
      }
    })();
    return operationPromise;
  };

  try {
    return await shimContext.with(spanContext as Context, invokeOnce);
  } catch {
    if (operationState.outcome.state === "resolved") return operationState.outcome.value;
    if (operationState.outcome.state === "rejected") throw operationState.outcome.error;
    if (operationPromise) return await operationPromise;
    return await invokeOnce();
  }
}

/** Return validated identifiers for the active trace. */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  try {
    const span = shimTrace.getActiveSpan?.();
    if (!span) return {};
    const ctx = span.spanContext();
    const traceId = typeof ctx.traceId === "string" && /^[0-9a-f]{32}$/i.test(ctx.traceId)
      ? ctx.traceId.toLowerCase()
      : undefined;
    const spanId = typeof ctx.spanId === "string" && /^[0-9a-f]{16}$/i.test(ctx.spanId)
      ? ctx.spanId.toLowerCase()
      : undefined;
    return {
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
    };
  } catch {
    return {};
  }
}

function normalizeSpanKind(value: unknown): SpanKind {
  return value === SpanKind.INTERNAL || value === SpanKind.SERVER || value === SpanKind.CLIENT ||
      value === SpanKind.PRODUCER || value === SpanKind.CONSUMER
    ? value
    : SpanKind.INTERNAL;
}
