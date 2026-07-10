/**
 * OpenTelemetry instrumentation for metrics
 * @module
 */

import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import { getGlobalMetricsAPI } from "#veryfront/observability/tracing/api-shim.ts";
import type { OtelInstruments } from "./types.ts";

// In-flight or completed init promise; null means init has not started.
// Using a promise (rather than a boolean flag) prevents a race where a second
// concurrent caller sees the flag set to true but instruments are not yet ready.
let initPromise: Promise<void> | null = null;
const otel: OtelInstruments = {};

export function safeLogWarn(message: string, error?: unknown): void {
  try {
    logger.warn(message, error);
  } catch (_) {
    /* expected: logger may be unavailable during bootstrap */
  }
}

async function doInitOtelInstruments(): Promise<void> {
  if (!isDeno) return;

  try {
    // The metrics API is injected by ext-observability-opentelemetry via setGlobalMetricsAPI().
    // When the extension is not active, the meter is unavailable and we return.
    const metricsApi = getGlobalMetricsAPI();
    if (!metricsApi) return;

    const meter = metricsApi.getMeter("veryfront", VERSION);

    otel.meter = meter;
    otel.ssrHistogram = meter.createHistogram("veryfront.ssr.duration", {
      description: "SSR render duration (ms)",
      unit: "ms",
    });
    otel.requestCounter = meter.createCounter("veryfront.http.requests", {
      description: "Requests handled",
    });
    otel.jitResolvedCounter = meter.createCounter("veryfront.jit.http.resolved", {
      description: "JIT HTTP resolved",
    });
    otel.jitBlockedCounter = meter.createCounter("veryfront.jit.http.blocked", {
      description: "JIT HTTP blocked",
    });
    otel.cacheGetCounter = meter.createCounter("veryfront.cache.gets", {
      description: "Cache gets",
    });
    otel.cacheHitCounter = meter.createCounter("veryfront.cache.hits", {
      description: "Cache hits",
    });
    otel.cacheMissCounter = meter.createCounter("veryfront.cache.misses", {
      description: "Cache misses",
    });
    otel.cacheSetCounter = meter.createCounter("veryfront.cache.sets", {
      description: "Cache sets",
    });
    otel.cacheInvalidateCounter = meter.createCounter("veryfront.cache.invalidations", {
      description: "Cache invalidations",
    });
    otel.moduleServeCounter = meter.createCounter("veryfront.module.serve.total", {
      description: "Module server responses by status",
    });
    otel.moduleTransformCounter = meter.createCounter("veryfront.module.transform.total", {
      description: "Module transforms",
    });
    otel.moduleTransformDurationHistogram = meter.createHistogram(
      "veryfront.module.transform.duration",
      {
        description: "Module transform duration (ms)",
        unit: "ms",
      },
    );
    otel.routeManifestLookupCounter = meter.createCounter("veryfront.route_manifest.lookup.total", {
      description: "Route module manifest LRU lookups by hit status",
    });
  } catch (e) {
    safeLogWarn("[metrics] OpenTelemetry init failed", e);
  }
}

export function ensureOtelInstruments(): Promise<void> {
  if (!initPromise) {
    initPromise = doInitOtelInstruments();
  }
  return initPromise;
}

export async function safeOtelOperation(
  operation: () => void | Promise<void>,
  errorContext: string,
): Promise<void> {
  try {
    await ensureOtelInstruments();
    await operation();
  } catch (e) {
    safeLogWarn(`[metrics] ${errorContext}`, e);
  }
}

export function getOtelInstruments(): OtelInstruments {
  return otel;
}

export function resetOtelInstruments(): void {
  initPromise = null;

  for (const key of Object.keys(otel) as (keyof OtelInstruments)[]) {
    delete otel[key];
  }
}
