/**
 * Lazy-loading observability metrics
 * @module
 */

import { serverLogger as logger } from "#veryfront/utils";
import type { ObservabilityMetrics } from "./types.ts";

let loadingPromise: Promise<ObservabilityMetrics | null> | null = null;

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
export async function getObservabilityMetrics(): Promise<ObservabilityMetrics | null> {
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const mod = await import("../../observability/metrics/index.ts");
      return {
        recordRender: mod.recordRender,
        recordCacheGet: mod.recordCacheGet,
        recordCacheSet: mod.recordCacheSet,
        recordCacheInvalidate: mod.recordCacheInvalidate,
        recordHttpRequest: mod.recordHttpRequest,
        recordRSCRequest: mod.recordRSCRequest,
        recordRSCStream: mod.recordRSCStream,
      };
    } catch (error) {
      logger.debug("[metrics] Observability module not available (metrics disabled)", { error });
      return null;
    }
  })();

  return loadingPromise;
}

/**
 * Reset observability loader state (useful for testing)
 */
export function resetObservabilityLoader(): void {
  loadingPromise = null;
}
