/****
 * OpenTelemetry OTLP tracing for proxy.
 *
 * The standalone proxy (split mode) does not run the server bootstrap, so it
 * wires the OTLP SDK itself: it loads ext-observability-opentelemetry, starts
 * its `OtlpTracingExporter`, and registers the SDK provider with the core
 * api-shim BEFORE caching a tracer. Without this wiring the shim only ever
 * hands out no-op tracers and nothing is exported (issue #2723).
 *
 * Env: OTEL_TRACES_ENABLED, OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT,
 *      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
 * (endpoint/headers are consumed by the extension itself.)
 */

import {
  type Context,
  context as shimContext,
  defaultTextMapGetter,
  defaultTextMapSetter,
  propagation as shimPropagation,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalMetricsAPI,
  setGlobalTracerProvider,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace as shimTrace,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getHostTelemetryEnv } from "#veryfront/observability";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "#veryfront/extensions/first-party-import.ts";
import { proxyLogger } from "./logger.ts";

const TRACING_EXTENSION_SOURCE_DIRECTORY = "ext-observability-opentelemetry";
const TRACING_EXTENSION_PACKAGE = "@veryfront/ext-observability-opentelemetry";

let initialized = false;
let initializationPromise: Promise<void> | null = null;
let tracer: Tracer | null = null;
let exporter: ProxyTracingExporter | null = null;

interface OTLPConfig {
  serviceName: string;
  endpoint: string;
  enabled: boolean;
}

function getConfig(): OTLPConfig {
  return {
    enabled: getHostTelemetryEnv("OTEL_TRACES_ENABLED") === "true",
    serviceName: getHostTelemetryEnv("OTEL_SERVICE_NAME") || "veryfront-proxy",
    // The extension prefers the traces-specific endpoint; mirror that here so
    // the gate agrees with what the exporter will actually use.
    endpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ||
      getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || "",
  };
}

/** Result of deciding whether OTLP tracing can start. */
export type OtlpGateResult = { ok: true } | { ok: false; reason: string };

/** Minimal exporter lifecycle required by standalone proxy tracing. */
export interface ProxyTracingExporter {
  /** Start the exporter and its provider. */
  start(config: Record<string, unknown>): Promise<void>;
  /** Flush pending telemetry and release resources. */
  shutdown(): Promise<void>;
  /** Return the initialized tracer provider. */
  getProvider(): unknown;
  /** Return the optional metrics API. */
  getMetricsAPI(): unknown | null;
  /** Return the optional active-span API. */
  getTraceAPI?(): unknown | null;
  /** Return the optional async-context API. */
  getContextAPI?(): unknown | null;
}

/** Minimal immutable trace context accepted by proxy lifecycle helpers. */
export interface ProxyTraceContext {
  /** Read a context value. */
  getValue(key: symbol): unknown;
  /** Return a context containing a value. */
  setValue(key: symbol, value: unknown): ProxyTraceContext;
  /** Return a context without a value. */
  deleteValue(key: symbol): ProxyTraceContext;
}

/** Scalar value accepted by proxy trace span attributes. */
export type ProxyTraceAttributePrimitive = string | number | boolean;

/** Value accepted by proxy trace span attributes. */
export type ProxyTraceAttributeValue =
  | ProxyTraceAttributePrimitive
  | readonly ProxyTraceAttributePrimitive[]
  | undefined;

/** Propagation identifiers returned by a proxy trace span. */
export interface ProxyTraceSpanContext {
  /** Lowercase 32-character hexadecimal trace identifier. */
  traceId: string;
  /** Lowercase 16-character hexadecimal span identifier. */
  spanId: string;
  /** W3C trace flags. */
  traceFlags: number;
}

/** Span surface exposed by proxy tracing helpers. */
export interface ProxyTraceSpan {
  /** Set one span attribute. */
  setAttribute(key: string, value: ProxyTraceAttributeValue): ProxyTraceSpan;
  /** Set several span attributes. */
  setAttributes(attrs: Record<string, ProxyTraceAttributeValue>): ProxyTraceSpan;
  /** Set the final span status. */
  setStatus(status: { code: number; message?: string }): ProxyTraceSpan;
  /** Record a sanitized exception. */
  recordException(error: unknown): void;
  /** Add a bounded event to the span. */
  addEvent(
    name: string,
    attributes?: Record<string, ProxyTraceAttributeValue>,
  ): ProxyTraceSpan;
  /** End the span at an optional timestamp. */
  end(endTime?: number): void;
  /** Return propagation identifiers for the span. */
  spanContext(): ProxyTraceSpanContext;
  /** Replace the span operation name. */
  updateName(name: string): void;
}

/** Remove credentials and request-specific values before recording a URL in telemetry. */
export function sanitizeProxySpanUrl(value: string | URL): string {
  try {
    const url = new URL(value.toString());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "[invalid-url]";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return "[invalid-url]";
  }
}

/**
 * Decide whether OTLP tracing should be initialized for this process.
 * Pure so the decision (and its logged reason) is unit-testable.
 */
export function resolveOtlpGate(
  config: { enabled: boolean; endpoint: string },
): OtlpGateResult {
  if (!config.enabled) {
    return { ok: false, reason: 'Tracing disabled: OTEL_TRACES_ENABLED is not "true"' };
  }
  if (!config.endpoint) {
    return {
      ok: false,
      reason:
        "Tracing disabled: no OTLP endpoint (set OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)",
    };
  }
  return { ok: true };
}

type TracingExporterModule = {
  OtlpTracingExporter: new () => ProxyTracingExporter;
};

/**
 * Load the OTLP tracing exporter from ext-observability-opentelemetry.
 *
 * Resolves the workspace source in repo/binary runs and the npm package in
 * Node installs. Returns `null` (after logging why) when the extension is not
 * installed or fails to load. Telemetry must never crash the proxy.
 */
async function loadTracingExporter(): Promise<ProxyTracingExporter | null> {
  try {
    const mod = await importFirstPartyExtensionModule<TracingExporterModule>(
      TRACING_EXTENSION_SOURCE_DIRECTORY,
      TRACING_EXTENSION_PACKAGE,
    );
    if (typeof mod.OtlpTracingExporter !== "function") {
      proxyLogger.warn(
        `[otel] Tracing disabled: ${TRACING_EXTENSION_PACKAGE} has no OtlpTracingExporter export`,
      );
      return null;
    }
    return new mod.OtlpTracingExporter();
  } catch (error) {
    if (
      isMissingFirstPartyExtensionModule(error, [
        `extensions/${TRACING_EXTENSION_SOURCE_DIRECTORY}/src/index`,
        TRACING_EXTENSION_PACKAGE,
      ])
    ) {
      proxyLogger.warn(
        `[otel] Tracing disabled: ${TRACING_EXTENSION_PACKAGE} is not installed; install it alongside veryfront to export traces`,
      );
      return null;
    }
    proxyLogger.error("[otel] Failed to load tracing extension", error);
    return null;
  }
}

/**
 * Initialize OTLP tracing for the standalone proxy.
 *
 * Loads ext-observability-opentelemetry, starts its exporter, wires the SDK
 * provider (plus metrics API and active-span accessor) into the core shim,
 * and only then caches a tracer. Logs `[otel] Initialized` only when a real
 * provider is wired; otherwise logs why tracing is disabled. Never throws.
 *
 * @param loadExporter Test seam; production callers use the default loader.
 */
export async function initializeOTLPWithApis(
  loadExporter: () => Promise<ProxyTracingExporter | null> = loadTracingExporter,
): Promise<void> {
  if (initialized) return;
  if (initializationPromise) return await initializationPromise;

  const initialize = async (): Promise<void> => {
    const config = getConfig();
    const gate = resolveOtlpGate(config);
    if (!gate.ok) {
      initialized = true;
      proxyLogger.info(`[otel] ${gate.reason}`);
      return;
    }

    let exporterImpl: ProxyTracingExporter | null = null;
    try {
      exporterImpl = await loadExporter();
      if (!exporterImpl) {
        initialized = true;
        return;
      }

      // The exporter reads OTEL_* env itself (endpoint, headers, signal gates)
      // and creates the SDK tracer provider with a batch OTLP span processor.
      await exporterImpl.start({});
      exporter = exporterImpl;

      // Wire the shim globals before getTracer(). The tracer is cached below,
      // so wiring afterwards would freeze the no-op tracer forever.
      setGlobalTracerProvider(
        exporterImpl.getProvider() as Parameters<typeof setGlobalTracerProvider>[0],
      );
      const metricsApi = exporterImpl.getMetricsAPI();
      if (metricsApi) {
        setGlobalMetricsAPI(metricsApi as Parameters<typeof setGlobalMetricsAPI>[0]);
      }
      const traceApi = exporterImpl.getTraceAPI?.();
      if (traceApi) {
        setGlobalActiveSpanAccessor(
          traceApi as Parameters<typeof setGlobalActiveSpanAccessor>[0],
        );
      }
      const contextApi = exporterImpl.getContextAPI?.();
      if (contextApi) {
        setGlobalContextAccessor(
          contextApi as Parameters<typeof setGlobalContextAccessor>[0],
        );
      }

      tracer = shimTrace.getTracer(config.serviceName);
      initialized = true;

      proxyLogger.info("[otel] Initialized", {
        serviceName: config.serviceName,
        endpointConfigured: true,
      });
    } catch (error) {
      exporter = null;
      tracer = null;
      initialized = false;
      if (exporterImpl) {
        try {
          await exporterImpl.shutdown();
        } catch (shutdownError) {
          proxyLogger.warn("[otel] Failed exporter cleanup after initialization error", {
            error: shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
          });
        }
      }
      proxyLogger.error("[otel] Init failed", error);
    }
  };

  const pending = Promise.resolve().then(initialize);
  initializationPromise = pending;
  try {
    await pending;
  } finally {
    if (initializationPromise === pending) initializationPromise = null;
  }
}

/** Flush pending spans and release the exporter. Safe to call when disabled. */
export async function shutdownOTLP(): Promise<void> {
  if (initializationPromise) await initializationPromise;
  const active = exporter;
  exporter = null;
  tracer = null;

  if (active) {
    try {
      await active.shutdown();
    } catch (error) {
      proxyLogger.warn("[otel] Exporter shutdown failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  proxyLogger.info("[otel] Shutdown complete");
}

/** Reset module state between tests. Mirrors api-shim's `_resetShimForTests`. */
export function _resetOTLPForTests(): void {
  initialized = false;
  initializationPromise = null;
  tracer = null;
  exporter = null;
}

/** Extract an inbound trace context without allowing telemetry failures to escape. */
export function extractContext(headers: Headers): ProxyTraceContext | undefined {
  try {
    const carrier: Record<string, string> = {};
    headers.forEach((v, k) => {
      carrier[k.toLowerCase()] = v;
    });

    return shimPropagation.extract(shimContext.active(), carrier, defaultTextMapGetter);
  } catch {
    return undefined;
  }
}

/** Inject the active trace context into outbound headers on a best-effort basis. */
export function injectContext(headers: Headers): void {
  try {
    const carrier: Record<string, string> = {};
    shimPropagation.inject(shimContext.active(), carrier, defaultTextMapSetter);

    for (const [k, v] of Object.entries(carrier)) {
      headers.set(k, v);
    }
  } catch {
    // Telemetry propagation is best effort and must not fail a proxy request.
  }
}

/** Start and activate a server span for one inbound proxy request. */
export function startServerSpan(
  method: string,
  path: string,
  parentContext?: ProxyTraceContext,
): { span: ProxyTraceSpan; context: ProxyTraceContext } | null {
  if (!tracer) return null;

  try {
    const ctx = parentContext ?? shimContext.active();
    const span = tracer.startSpan(`${method} ${path}`, { kind: SpanKind.SERVER }, ctx);
    return { span, context: shimTrace.setSpan(ctx, span) };
  } catch {
    return null;
  }
}

function safeSpanError(error: Error): Error {
  const sanitized = new Error("Proxy operation failed");
  sanitized.name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : "Error";
  sanitized.stack = undefined;
  return sanitized;
}

/** Finalize a request span with a status and sanitized exception details. */
export function endSpan(
  span: ProxyTraceSpan | undefined,
  statusCode: number,
  error?: Error,
): void {
  if (!span) return;

  try {
    span.setAttribute("http.status_code", statusCode);

    if (error) {
      const safeError = safeSpanError(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: safeError.message });
      span.recordException(safeError);
      return;
    }

    if (statusCode >= 400) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  } catch {
    // Exporter span implementations are external and must not fail requests.
  } finally {
    try {
      span.end();
    } catch {
      // Ending telemetry is best effort.
    }
  }
}

/** Run an asynchronous operation inside a trace context with a safe fallback. */
export function withContext<T>(
  spanContext: ProxyTraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return shimContext.with(spanContext, fn);
  } catch {
    return fn();
  }
}

function getActiveSpanContext(): { traceId: string; spanId: string } | null {
  try {
    const activeSpan = shimTrace.getActiveSpan?.();
    return activeSpan ? activeSpan.spanContext() : null;
  } catch {
    return null;
  }
}

/** Return validated active trace identifiers for structured log correlation. */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  const spanContext = getActiveSpanContext();
  if (!spanContext) return {};
  if (!/^[0-9a-f]{32}$/i.test(spanContext.traceId) || !/^[0-9a-f]{16}$/i.test(spanContext.spanId)) {
    return {};
  }
  return { traceId: spanContext.traceId.toLowerCase(), spanId: spanContext.spanId.toLowerCase() };
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

  let span: Span;
  let spanContext: Context;
  try {
    const parentContext = shimContext.active();
    span = tracer.startSpan(
      name,
      { kind: SpanKind.INTERNAL, attributes },
      parentContext,
    );
    spanContext = shimTrace.setSpan(parentContext, span);
  } catch {
    return await fn();
  }

  let execution: Promise<T>;
  try {
    execution = shimContext.with(spanContext, fn);
  } catch {
    execution = fn();
  }

  try {
    const result = await execution;
    try {
      span.setStatus({ code: SpanStatusCode.OK });
    } catch {
      // Exporter span implementations are external and best effort.
    }
    return result;
  } catch (error) {
    const safeError = safeSpanError(
      error instanceof Error ? error : new Error("Non-Error exception"),
    );
    try {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: safeError.message,
      });
      span.recordException(safeError);
    } catch {
      // Telemetry failure must not replace the application error.
    }
    throw error;
  } finally {
    try {
      span.end();
    } catch {
      // Ending telemetry is best effort.
    }
  }
}
