/**
 * OpenTelemetry instrumentation for metrics
 * @module
 */

import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import {
  getGlobalMetricsAPI,
  getGlobalMetricsAPIRevision,
} from "#veryfront/observability/tracing/api-shim.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import type { OtelInstruments } from "./types.ts";

// In-flight or completed init promise; null means init has not started.
// Using a promise (rather than a boolean flag) prevents a race where a second
// concurrent caller sees the flag set to true but instruments are not yet ready.
let initPromise: Promise<void> | null = null;
let initializingRevision = -1;
let activeRevision = -1;
const otel: OtelInstruments = {};

export function safeLogWarn(message: string, error?: unknown): void {
  try {
    if (error === undefined) {
      logger.warn(message);
      return;
    }
    logger.warn(message, { failure_category: classifyTelemetryError(error) });
  } catch (_) {
    /* expected: logger may be unavailable during bootstrap */
  }
}

async function doInitOtelInstruments(revision: number): Promise<void> {
  if (!isDeno) return;

  try {
    // The metrics API is injected by ext-observability-opentelemetry via setGlobalMetricsAPI().
    // When the extension is not active, the meter is unavailable and we return.
    const metricsApi = getGlobalMetricsAPI();
    if (!metricsApi) return;

    const meter = metricsApi.getMeter("veryfront", VERSION);
    const next: OtelInstruments = { meter };
    next.ssrHistogram = meter.createHistogram("veryfront.ssr.duration", {
      description: "SSR render duration (ms)",
      unit: "ms",
    });
    next.requestCounter = meter.createCounter("veryfront.http.requests", {
      description: "Requests handled",
    });
    next.jitResolvedCounter = meter.createCounter("veryfront.jit.http.resolved", {
      description: "JIT HTTP resolved",
    });
    next.jitBlockedCounter = meter.createCounter("veryfront.jit.http.blocked", {
      description: "JIT HTTP blocked",
    });
    next.cacheGetCounter = meter.createCounter("veryfront.cache.gets", {
      description: "Cache gets",
    });
    next.cacheHitCounter = meter.createCounter("veryfront.cache.hits", {
      description: "Cache hits",
    });
    next.cacheMissCounter = meter.createCounter("veryfront.cache.misses", {
      description: "Cache misses",
    });
    next.cacheSetCounter = meter.createCounter("veryfront.cache.sets", {
      description: "Cache sets",
    });
    next.cacheInvalidateCounter = meter.createCounter("veryfront.cache.invalidations", {
      description: "Cache invalidations",
    });
    next.moduleServeCounter = meter.createCounter("veryfront.module.serve.total", {
      description: "Module server responses by status",
    });
    next.moduleTransformCounter = meter.createCounter("veryfront.module.transform.total", {
      description: "Module transforms",
    });
    next.moduleTransformDurationHistogram = meter.createHistogram(
      "veryfront.module.transform.duration",
      {
        description: "Module transform duration (ms)",
        unit: "ms",
      },
    );
    next.routeManifestLookupCounter = meter.createCounter("veryfront.route_manifest.lookup.total", {
      description: "Route module manifest LRU lookups by hit status",
    });
    if (getGlobalMetricsAPIRevision() !== revision) return;

    for (const key of Object.keys(otel) as (keyof OtelInstruments)[]) {
      delete otel[key];
    }
    Object.assign(otel, next);
    activeRevision = revision;
  } catch (e) {
    safeLogWarn("[metrics] OpenTelemetry init failed", e);
  }
}

export function ensureOtelInstruments(): Promise<void> {
  const revision = getGlobalMetricsAPIRevision();
  if (activeRevision === revision) return Promise.resolve();
  if (!initPromise || initializingRevision !== revision) {
    initializingRevision = revision;
    initPromise = doInitOtelInstruments(revision);
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
  initializingRevision = -1;
  activeRevision = -1;

  for (const key of Object.keys(otel) as (keyof OtelInstruments)[]) {
    delete otel[key];
  }
}
