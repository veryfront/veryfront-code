/**
 * OpenTelemetry instrumentation for metrics
 * @module
 */

import { serverLogger as logger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import {
  getGlobalMetricsAPI,
  getMetricsApiRevision,
} from "#veryfront/observability/tracing/api-shim.ts";
import type { OtelInstruments } from "./types.ts";

// A single in-flight attempt is shared by callers for a provider revision.
let initPromise: Promise<void> | null = null;
let initializingRevision = -1;
let initializedRevision = -1;
let lifecycleGeneration = 0;
const otel: OtelInstruments = {};

function clearOtelInstruments(): void {
  for (const key of Object.keys(otel) as (keyof OtelInstruments)[]) {
    delete otel[key];
  }
}

export function safeLogWarn(message: string, error?: unknown): void {
  try {
    logger.warn(message, error);
  } catch (_) {
    /* expected: logger may be unavailable during bootstrap */
  }
}

async function createOtelInstruments(): Promise<OtelInstruments | null> {
  try {
    // The metrics API is injected by ext-observability-opentelemetry via setGlobalMetricsAPI().
    // When the extension is not active, the meter is unavailable and we return.
    const metricsApi = getGlobalMetricsAPI();
    if (!metricsApi) return {};

    const meter = metricsApi.getMeter("veryfront", VERSION);
    const candidate: OtelInstruments = { meter };

    candidate.ssrHistogram = meter.createHistogram("veryfront.ssr.duration", {
      description: "SSR render duration (ms)",
      unit: "ms",
    });
    candidate.requestCounter = meter.createCounter("veryfront.http.requests", {
      description: "Requests handled",
    });
    candidate.jitResolvedCounter = meter.createCounter("veryfront.jit.http.resolved", {
      description: "JIT HTTP resolved",
    });
    candidate.jitBlockedCounter = meter.createCounter("veryfront.jit.http.blocked", {
      description: "JIT HTTP blocked",
    });
    candidate.cacheGetCounter = meter.createCounter("veryfront.cache.gets", {
      description: "Cache gets",
    });
    candidate.cacheHitCounter = meter.createCounter("veryfront.cache.hits", {
      description: "Cache hits",
    });
    candidate.cacheMissCounter = meter.createCounter("veryfront.cache.misses", {
      description: "Cache misses",
    });
    candidate.cacheSetCounter = meter.createCounter("veryfront.cache.sets", {
      description: "Cache sets",
    });
    candidate.cacheInvalidateCounter = meter.createCounter("veryfront.cache.invalidations", {
      description: "Cache invalidations",
    });
    candidate.moduleServeCounter = meter.createCounter("veryfront.module.serve.total", {
      description: "Module server responses by status",
    });
    candidate.moduleTransformCounter = meter.createCounter("veryfront.module.transform.total", {
      description: "Module transforms",
    });
    candidate.moduleTransformDurationHistogram = meter.createHistogram(
      "veryfront.module.transform.duration",
      {
        description: "Module transform duration (ms)",
        unit: "ms",
      },
    );
    candidate.routeManifestLookupCounter = meter.createCounter(
      "veryfront.route_manifest.lookup.total",
      {
        description: "Route module manifest LRU lookups by hit status",
      },
    );
    return candidate;
  } catch (e) {
    safeLogWarn("[metrics] OpenTelemetry init failed", e);
    return null;
  }
}

export function ensureOtelInstruments(): Promise<void> {
  const providerRevision = getMetricsApiRevision();
  if (initializedRevision === providerRevision) return Promise.resolve();
  if (initPromise && initializingRevision === providerRevision) return initPromise;

  clearOtelInstruments();
  initializingRevision = providerRevision;
  const generation = lifecycleGeneration;
  const attempt = createOtelInstruments()
    .then((candidate) => {
      if (
        !candidate || generation !== lifecycleGeneration ||
        getMetricsApiRevision() !== providerRevision
      ) return;
      Object.assign(otel, candidate);
      initializedRevision = providerRevision;
    })
    .finally(() => {
      if (initPromise !== attempt) return;
      initPromise = null;
      initializingRevision = -1;
    });
  initPromise = attempt;
  return attempt;
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
  lifecycleGeneration++;
  initPromise = null;
  initializingRevision = -1;
  initializedRevision = -1;
  clearOtelInstruments();
}
