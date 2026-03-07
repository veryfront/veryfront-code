/**
 * OpenTelemetry instrumentation for metrics
 * @module
 */

import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import type { OtelInstruments } from "./types.ts";

let otelInitialized = false;
const otel: OtelInstruments = {};

export function safeLogWarn(message: string, error?: unknown): void {
  try {
    logger.warn(message, error);
  } catch (_) {
    /* expected: logger may be unavailable during bootstrap */
  }
}

export async function ensureOtelInstruments(): Promise<void> {
  if (otelInitialized) return;
  otelInitialized = true;

  if (!isDeno) return;

  try {
    const { metrics } = await import("@opentelemetry/api");
    const meter = metrics.getMeter("veryfront", VERSION);

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
  } catch (e) {
    safeLogWarn("[metrics] OpenTelemetry init failed", e);
  }
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
  otelInitialized = false;

  for (const key of Object.keys(otel) as (keyof OtelInstruments)[]) {
    delete otel[key];
  }
}
