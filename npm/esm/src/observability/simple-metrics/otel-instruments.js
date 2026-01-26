/**
 * OpenTelemetry instrumentation for metrics
 * @module
 */
import { serverLogger as logger } from "../../utils/index.js";
import { isDeno } from "../../platform/compat/runtime.js";
let otelInitialized = false;
const otel = {};
export function safeLogWarn(message, error) {
    try {
        logger.warn(message, error);
    }
    catch {
        // Logger unavailable
    }
}
export async function ensureOtelInstruments() {
    if (otelInitialized)
        return;
    otelInitialized = true;
    if (!isDeno)
        return;
    try {
        const { metrics } = await import("@opentelemetry/api");
        const meter = metrics.getMeter("veryfront", "0.1.0");
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
    }
    catch (e) {
        safeLogWarn("[metrics] OpenTelemetry init failed", e);
    }
}
export async function safeOtelOperation(operation, errorContext) {
    try {
        await ensureOtelInstruments();
        await operation();
    }
    catch (e) {
        safeLogWarn(`[metrics] ${errorContext}`, e);
    }
}
export function getOtelInstruments() {
    return otel;
}
export function resetOtelInstruments() {
    otelInitialized = false;
    for (const key of Object.keys(otel)) {
        delete otel[key];
    }
}
