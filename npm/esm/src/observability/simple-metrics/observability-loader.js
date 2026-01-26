/**
 * Lazy-loading observability metrics
 * @module
 */
import { serverLogger as logger } from "../../utils/index.js";
let observabilityMetrics = null;
let observabilityLoadAttempted = false;
/**
 * Get observability metrics with lazy loading
 *
 * @returns Observability metrics instance or null if unavailable
 *
 * @example
 * ```ts
 * const obs = await getObservabilityMetrics()
 * obs?.recordRender(100)
 * ```
 */
export async function getObservabilityMetrics() {
    if (observabilityLoadAttempted)
        return observabilityMetrics;
    observabilityLoadAttempted = true;
    try {
        const mod = await import("../metrics/index.js");
        observabilityMetrics = {
            recordRender: mod.recordRender,
            recordCacheGet: mod.recordCacheGet,
            recordCacheSet: mod.recordCacheSet,
            recordCacheInvalidate: mod.recordCacheInvalidate,
            recordHttpRequest: mod.recordHttpRequest,
            recordRSCRequest: mod.recordRSCRequest,
            recordRSCStream: mod.recordRSCStream,
        };
        return observabilityMetrics;
    }
    catch (error) {
        logger.debug("[metrics] Observability module not available (metrics disabled)", { error });
        return null;
    }
}
/**
 * Reset observability loader state (useful for testing)
 */
export function resetObservabilityLoader() {
    observabilityMetrics = null;
    observabilityLoadAttempted = false;
}
