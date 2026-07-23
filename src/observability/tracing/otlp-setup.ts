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
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
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
  sanitizeErrorForTelemetry,
  sanitizeTelemetryAttributes,
  sanitizeTelemetryAttributeValue,
} from "../telemetry-error.ts";
import { runAsyncWithContextFallback, runSyncWithContextFallback } from "./context-callback.ts";

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

function reportTelemetryFailure(failureMessage: string, error: unknown): void {
  try {
    logger.debug(failureMessage, error);
  } catch (_) {
    /* expected: telemetry and logging failures must not affect application work */
  }
}

function runTelemetryOperation(operation: () => void, failureMessage: string): void {
  try {
    operation();
  } catch (error) {
    reportTelemetryFailure(failureMessage, error);
  }
}

function createInertContext(
  entries: ReadonlyMap<symbol, unknown> = new Map(),
): Context {
  const values = new Map(entries);
  return Object.freeze({
    getValue: (key: symbol) => values.get(key),
    setValue(key: symbol, value: unknown) {
      const next = new Map(values);
      next.set(key, value);
      return createInertContext(next);
    },
    deleteValue(key: symbol) {
      const next = new Map(values);
      next.delete(key);
      return createInertContext(next);
    },
  });
}

function createInertSpan(): Span {
  const spanContext = Object.freeze({
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    traceFlags: 0,
  });
  const span: Span = Object.freeze({
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => {},
    addEvent: () => span,
    end: () => {},
    spanContext: () => spanContext,
    updateName: () => {},
  });
  return span;
}

function isUsableSpan(value: unknown): value is Span {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  try {
    const candidate = value as Span;
    return typeof candidate.setAttribute === "function" &&
      typeof candidate.setAttributes === "function" &&
      typeof candidate.setStatus === "function" &&
      typeof candidate.recordException === "function" &&
      typeof candidate.addEvent === "function" &&
      typeof candidate.end === "function" &&
      typeof candidate.spanContext === "function" &&
      typeof candidate.updateName === "function";
  } catch (_) {
    return false;
  }
}

function getActiveContextSafely(): Context {
  try {
    const activeContext = shimContext.active();
    if (activeContext) return activeContext;
  } catch (error) {
    reportTelemetryFailure("Failed to read active tracing context", error);
  }
  return createInertContext();
}

function startSpanWithFallback(
  name: string,
  attributes: Record<string, AttributeValue> | undefined,
  options: WithSpanOptions | undefined,
): { span: Span; context: Context } {
  const parentContext = getActiveContextSafely();
  let span = createInertSpan();

  try {
    const candidate = getTracingRuntime().tracer.startSpan(
      name,
      {
        kind: options?.kind ?? SpanKind.INTERNAL,
        attributes: sanitizeTelemetryAttributes(attributes),
      },
      parentContext,
    );
    if (!isUsableSpan(candidate)) {
      throw new TypeError("Tracer returned an invalid span");
    }
    span = candidate;
  } catch (error) {
    reportTelemetryFailure("Failed to start span; using inert span", error);
  }

  let spanContext = parentContext;
  try {
    spanContext = shimTrace.setSpan(parentContext, span);
  } catch (error) {
    reportTelemetryFailure("Failed to associate span with context", error);
  }
  return { span, context: spanContext };
}

function setSpanErrorStatus(span: Span, error: unknown): void {
  const telemetryError = sanitizeErrorForTelemetry(error);
  runTelemetryOperation(
    () =>
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: telemetryError.message,
      }),
    "Failed to set span error status",
  );
  runTelemetryOperation(
    () => span.recordException(telemetryError),
    "Failed to record span exception",
  );
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
  const { span, context: spanContext } = startSpanWithFallback(name, attributes, options);

  try {
    const result = await runAsyncWithContextFallback(
      (callback) => shimContext.with(spanContext, callback),
      () => fn(span),
      (error) => reportTelemetryFailure("Failed to activate span context", error),
    );
    return result;
  } catch (error) {
    setSpanErrorStatus(span, error);
    throw error;
  } finally {
    runTelemetryOperation(() => span.end(), "Failed to end span");
  }
}

/** Applies span sync. */
export function withSpanSync<T>(
  name: string,
  fn: () => T,
  attributes?: Record<string, AttributeValue>,
  options?: WithSpanOptions,
): T {
  const { span, context: spanContext } = startSpanWithFallback(name, attributes, options);

  try {
    const result = runSyncWithContextFallback(
      (callback) => shimContext.with(spanContext, callback),
      fn,
      (error) => reportTelemetryFailure("Failed to activate span context", error),
    );
    runTelemetryOperation(
      () => span.setStatus({ code: SpanStatusCode.OK }),
      "Failed to set span success status",
    );
    return result;
  } catch (error) {
    setSpanErrorStatus(span, error);
    throw error;
  } finally {
    runTelemetryOperation(() => span.end(), "Failed to end span");
  }
}

/** Context for extract. */
export function extractContext(headers: Headers): Context | undefined {
  try {
    const carrier: Record<string, string> = {};
    for (const [k, v] of headers) carrier[k.toLowerCase()] = v;
    return shimPropagation.extract(getActiveContextSafely(), carrier, defaultTextMapGetter);
  } catch (error) {
    reportTelemetryFailure("Failed to extract tracing context", error);
    return undefined;
  }
}

/** Context for inject. */
export function injectContext(headers: Headers): void {
  try {
    const carrier: Record<string, string> = {};
    shimPropagation.inject(getActiveContextSafely(), carrier, defaultTextMapSetter);
    for (const [k, v] of Object.entries(carrier)) headers.set(k, v);
  } catch (error) {
    reportTelemetryFailure("Failed to inject tracing context", error);
  }
}

/** Starts server span. */
export function startServerSpan(
  method: string,
  path: string,
  parentContext?: unknown,
): { span: Span; context: Context } | null {
  let ctx: Context;
  let spanPath: string;
  let span: Span;
  try {
    ctx = (parentContext ?? getActiveContextSafely()) as Context;
    spanPath = sanitizeUrlForSpan(path);
    const candidate = getTracingRuntime().tracer.startSpan(
      `${method} ${spanPath}`,
      { kind: SpanKind.SERVER },
      ctx,
    );
    if (!isUsableSpan(candidate)) throw new TypeError("Tracer returned an invalid server span");
    span = candidate;
  } catch (error) {
    reportTelemetryFailure("Failed to start server span", error);
    return null;
  }

  runTelemetryOperation(
    () => span.setAttribute("http.method", sanitizeTelemetryAttributeValue("http.method", method)),
    "Failed to set server span method",
  );
  runTelemetryOperation(
    () =>
      span.setAttribute(
        "http.target",
        sanitizeTelemetryAttributeValue("http.target", spanPath),
      ),
    "Failed to set server span target",
  );

  let spanContext = ctx;
  try {
    spanContext = shimTrace.setSpan(ctx, span);
  } catch (error) {
    reportTelemetryFailure("Failed to associate server span with context", error);
  }
  return { span, context: spanContext };
}

/** End an active server tracing span. */
export function endServerSpan(span: unknown, statusCode: number, error?: Error): void {
  if (!span) return;

  const otelSpan = span as Span;
  runTelemetryOperation(
    () => otelSpan.setAttribute("http.status_code", statusCode),
    "Failed to set server span status code",
  );

  if (error) {
    setSpanErrorStatus(otelSpan, error);
    runTelemetryOperation(() => otelSpan.end(), "Failed to end server span");
    return;
  }

  if (statusCode >= 400) {
    runTelemetryOperation(
      () => otelSpan.setStatus({ code: SpanStatusCode.ERROR }),
      "Failed to set server span error status",
    );
    runTelemetryOperation(() => otelSpan.end(), "Failed to end server span");
    return;
  }

  runTelemetryOperation(
    () => otelSpan.setStatus({ code: SpanStatusCode.OK }),
    "Failed to set server span success status",
  );
  runTelemetryOperation(() => otelSpan.end(), "Failed to end server span");
}

/** Sets span attributes. */
export function setSpanAttributes(
  span: unknown,
  attributes: Record<string, AttributeValue>,
): void {
  if (!span) return;

  const otelSpan = span as Span;
  for (const [key, value] of Object.entries(sanitizeTelemetryAttributes(attributes))) {
    runTelemetryOperation(
      () => otelSpan.setAttribute(key, value),
      "Failed to set span attribute",
    );
  }
}

/** Adds an event to a span. */
export function addSpanEvent(
  span: unknown,
  name: string,
  attributes?: Record<string, AttributeValue>,
): void {
  if (!span) return;

  const otelSpan = span as Span;
  runTelemetryOperation(
    () => otelSpan.addEvent(name, sanitizeTelemetryAttributes(attributes)),
    "Failed to add span event",
  );
}

/** Sets active span attributes. */
export function setActiveSpanAttributes(
  attributes: Record<string, AttributeValue>,
): void {
  const span = shimTrace.getActiveSpan?.();
  if (!span) return;

  for (const [key, value] of Object.entries(sanitizeTelemetryAttributes(attributes))) {
    runTelemetryOperation(
      () => span.setAttribute(key, value),
      "Failed to set active span attribute",
    );
  }
}

/** Marks the active span as failed. */
export function setActiveSpanErrorStatus(error: unknown): void {
  const span = shimTrace.getActiveSpan?.();
  if (!span) return;

  setSpanErrorStatus(span, error);
}

/** Context for with. */
export async function withContext<T>(spanContext: unknown, fn: () => Promise<T>): Promise<T> {
  return await runAsyncWithContextFallback(
    (callback) => shimContext.with(spanContext as Context, callback),
    fn,
    (error) => logger.debug("Failed to activate explicit span context", error),
  );
}

/** Context for get trace. */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = shimTrace.getActiveSpan?.();
  if (!span) return {};

  try {
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  } catch (_) {
    return {};
  }
}
