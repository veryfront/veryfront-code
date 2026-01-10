/**
 * OpenTelemetry instrumentation for metrics
 * @module
 */

import { serverLogger as logger } from "@veryfront/utils";
import type { OtelInstruments } from "./types.ts";

/**
 * Check if running in Deno at runtime
 * We use a function instead of a constant to ensure proper detection
 * in bundled environments where constants may be evaluated at build time
 */
function isDenoRuntime(): boolean {
  return typeof Deno !== "undefined";
}

let otelInitialized = false;
const otel: OtelInstruments = {};

/**
 * Safe logging wrapper that won't throw if logger unavailable
 *
 * @param message - Log message
 * @param error - Optional error object
 */
export function safeLogWarn(message: string, error?: unknown): void {
  try {
    logger.warn(message, error);
  } catch {
    // Logger unavailable
  }
}

/**
 * Ensure OpenTelemetry instruments are initialized
 *
 * @returns Promise that resolves when initialization is complete
 *
 * @example
 * ```ts
 * await ensureOtelInstruments()
 * otel.requestCounter?.add(1)
 * ```
 */
export async function ensureOtelInstruments(): Promise<void> {
  if (otelInitialized) return;
  otelInitialized = true;

  // Skip OpenTelemetry in non-Deno runtimes (Node.js, Bun)
  // The npm: protocol is Deno-specific and will fail in other runtimes
  if (!isDenoRuntime()) return;

  try {
    const mod = await import("@opentelemetry/api");
    const meter = mod.metrics.getMeter("veryfront", "0.1.0");
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

/**
 * Execute OpenTelemetry operation with error handling
 *
 * @param operation - Operation to execute
 * @param errorContext - Error context for logging
 *
 * @example
 * ```ts
 * await safeOtelOperation(() => otel.requestCounter?.add(1), 'request counter failed')
 * ```
 */
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

/**
 * Get OpenTelemetry instruments
 *
 * @returns OpenTelemetry instruments
 */
export function getOtelInstruments(): OtelInstruments {
  return otel;
}

/**
 * Reset OpenTelemetry initialization state (useful for testing)
 */
export function resetOtelInstruments(): void {
  otelInitialized = false;
  Object.keys(otel).forEach((key) => delete otel[key as keyof OtelInstruments]);
}
