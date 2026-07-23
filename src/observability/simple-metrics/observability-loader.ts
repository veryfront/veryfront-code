/**
 * Lazy-loading observability metrics
 * @module
 */

import { serverLogger } from "#veryfront/utils";
import type { ObservabilityMetrics } from "./types.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";

const logger = serverLogger.component("metrics");

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
      const mod = await import("../metrics/index.ts");
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
      try {
        logger.debug("Observability module not available (metrics disabled)", {
          failure_category: classifyTelemetryError(error),
        });
      } catch {
        // Lazy metrics remain optional when logging is unavailable.
      }
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
