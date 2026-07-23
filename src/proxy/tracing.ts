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
  type GlobalTelemetryAPIInstallation,
  installGlobalTelemetryAPI,
  propagation as shimPropagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace as shimTrace,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getHostTelemetryEnv } from "#veryfront/observability";
import type { TracingExporter } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "#veryfront/extensions/first-party-import.ts";
import { proxyLogger } from "./logger.ts";

const TRACING_EXTENSION_SOURCE_DIRECTORY = "ext-observability-opentelemetry";
const TRACING_EXTENSION_PACKAGE = "@veryfront/ext-observability-opentelemetry";

let initializationPromise: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;
let lifecycleGeneration = 0;
let tracer: Tracer | null = null;
let exporter: TracingExporter | null = null;
let telemetryInstallation: GlobalTelemetryAPIInstallation | null = null;

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

export type OtlpGateResult = { ok: true } | { ok: false; reason: string };

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
  OtlpTracingExporter: new () => TracingExporter;
};

/**
 * Load the OTLP tracing exporter from ext-observability-opentelemetry.
 *
 * Resolves the workspace source in repo/binary runs and the npm package in
 * Node installs. Returns `null` (after logging why) when the extension is not
 * installed or fails to load — telemetry must never crash the proxy.
 */
async function loadTracingExporter(): Promise<TracingExporter | null> {
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
export function initializeOTLPWithApis(
  loadExporter: () => Promise<TracingExporter | null> = loadTracingExporter,
): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise.then(() => initializeOTLPWithApis(loadExporter));
  }
  if (exporter && telemetryInstallation && tracer) return Promise.resolve();
  if (initializationPromise) return initializationPromise;

  const generation = lifecycleGeneration;
  const attempt = initializeOTLPAttempt(loadExporter, generation).finally(() => {
    if (initializationPromise === attempt) initializationPromise = null;
  });
  initializationPromise = attempt;
  return attempt;
}

async function initializeOTLPAttempt(
  loadExporter: () => Promise<TracingExporter | null>,
  generation: number,
): Promise<void> {
  let candidate: TracingExporter | null = null;
  let candidateInstallation: GlobalTelemetryAPIInstallation | null = null;
  let ownershipTransferred = false;

  const config = getConfig();
  const gate = resolveOtlpGate(config);
  if (!gate.ok) {
    proxyLogger.info(`[otel] ${gate.reason}`);
    return;
  }

  try {
    candidate = await loadExporter();
    if (!candidate) return; // loader already logged the reason
    if (generation !== lifecycleGeneration) return;

    // The exporter reads OTEL_* env itself (endpoint, headers, signal gates)
    // and creates the SDK tracer provider with a batch OTLP span processor.
    await candidate.start({});
    if (generation !== lifecycleGeneration) return;

    // Read the complete facade before installing any part of it. The shim then
    // publishes one generation atomically, so consumers never observe a new
    // tracer paired with stale metrics/context accessors.
    const provider = candidate.getProvider();
    const metricsApi = candidate.getMetricsAPI();
    const traceApi = candidate.getTraceAPI?.() ?? null;
    const contextApi = candidate.getContextAPI?.() ?? null;
    candidateInstallation = installGlobalTelemetryAPI({
      tracerProvider: provider as Parameters<typeof installGlobalTelemetryAPI>[0]["tracerProvider"],
      metricsApi: metricsApi as Parameters<typeof installGlobalTelemetryAPI>[0]["metricsApi"],
      activeSpanAccessor: traceApi as Parameters<
        typeof installGlobalTelemetryAPI
      >[0]["activeSpanAccessor"],
      contextAccessor: contextApi as Parameters<
        typeof installGlobalTelemetryAPI
      >[0]["contextAccessor"],
    });

    const candidateTracer = shimTrace.getTracer(config.serviceName);
    if (generation !== lifecycleGeneration) return;

    exporter = candidate;
    telemetryInstallation = candidateInstallation;
    tracer = candidateTracer;
    ownershipTransferred = true;

    proxyLogger.info("[otel] Initialized", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });
  } catch (error) {
    proxyLogger.error("[otel] Init failed", error);
  } finally {
    if (!ownershipTransferred) {
      candidateInstallation?.dispose();
    }
    // `start()` may allocate processors before rejecting, and facade getters
    // can fail after startup. An uncommitted candidate always remains owned by
    // this attempt and must be released before the attempt settles.
    if (!ownershipTransferred && candidate) {
      try {
        await candidate.shutdown();
      } catch (_) {
        /* expected: initialization failure remains the primary diagnostic */
      }
    }
  }
}

/** Flush pending spans and release the exporter. Safe to call when disabled. */
export function shutdownOTLP(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  lifecycleGeneration++;
  const pendingInitialization = initializationPromise;
  const active = exporter;
  const installation = telemetryInstallation;
  exporter = null;
  telemetryInstallation = null;
  tracer = null;
  installation?.dispose();

  const attempt = (async () => {
    if (pendingInitialization) await pendingInitialization;

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
  })().finally(() => {
    if (shutdownPromise === attempt) shutdownPromise = null;
  });
  shutdownPromise = attempt;
  return attempt;
}

/** Reset module state between tests. Mirrors api-shim's `_resetShimForTests`. */
export function _resetOTLPForTests(): void {
  lifecycleGeneration++;
  telemetryInstallation?.dispose();
  initializationPromise = null;
  shutdownPromise = null;
  tracer = null;
  exporter = null;
  telemetryInstallation = null;
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
