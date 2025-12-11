
import { serverLogger as logger } from "@veryfront/utils";
import type { ObservabilityMetrics } from "./types.ts";

let observabilityMetrics: ObservabilityMetrics | null = null;
let observabilityLoadAttempted = false;

export async function getObservabilityMetrics(): Promise<ObservabilityMetrics | null> {
  if (observabilityLoadAttempted) {
    return observabilityMetrics;
  }

  observabilityLoadAttempted = true;

  try {
    const mod = await import("../../observability/metrics/index.ts");
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
  } catch (error) {
    logger.debug("[metrics] Observability module not available (metrics disabled)", { error });
    return null;
  }
}

export function resetObservabilityLoader(): void {
  observabilityMetrics = null;
  observabilityLoadAttempted = false;
}
