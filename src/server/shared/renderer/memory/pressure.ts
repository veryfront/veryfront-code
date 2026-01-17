/**
 * Memory Pressure Management
 *
 * Provides memory checks to prevent OOM conditions.
 *
 * @module server/shared/renderer/memory/pressure
 */

import { rendererLogger } from "@veryfront/utils";
import { getHeapStats } from "@veryfront/utils/memory/index.ts";

/**
 * Check if memory is too high to safely process a request.
 * Returns true if the request should be rejected to prevent OOM.
 *
 * This is a fast, synchronous check that should be called before starting
 * expensive SSR operations.
 */
export function shouldRejectDueToMemory(): boolean {
  const heap = getHeapStats();
  // Reject if we're above 90% of heap limit - OOM is imminent
  if (heap.heapUsedPercent >= 90) {
    rendererLogger.warn("[Renderer] Rejecting request - memory critical", {
      heapUsedMB: heap.usedHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      heapUsedPercent: heap.heapUsedPercent,
    });
    return true;
  }
  return false;
}
