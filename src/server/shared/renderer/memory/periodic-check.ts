/**
 * Periodic Memory Check
 *
 * Background monitoring for memory pressure.
 *
 * @module server/shared/renderer/memory/periodic-check
 */

import { rendererLogger } from "@veryfront/utils";
import {
  MEMORY_CHECK_INTERVAL_MS,
  MEMORY_PRESSURE_CRITICAL,
  MEMORY_PRESSURE_WARNING,
} from "../constants.ts";
import { memoryCheckInterval, setMemoryCheckInterval } from "../state.ts";
import { checkAndEvictUnderMemoryPressure } from "./pressure.ts";

/**
 * Start periodic memory pressure checks.
 * This catches slow memory growth even when no new renderers are being created.
 * Should be called when the server starts.
 */
export function startPeriodicMemoryCheck(): void {
  if (memoryCheckInterval) {
    rendererLogger.debug("[RendererFactory] Periodic memory check already running");
    return;
  }

  rendererLogger.info("[RendererFactory] Starting periodic memory check", {
    intervalMs: MEMORY_CHECK_INTERVAL_MS,
    warningThreshold: MEMORY_PRESSURE_WARNING,
    criticalThreshold: MEMORY_PRESSURE_CRITICAL,
  });

  const interval = setInterval(async () => {
    try {
      await checkAndEvictUnderMemoryPressure("periodic");
    } catch (error) {
      rendererLogger.error("[RendererFactory] Error in periodic memory check", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, MEMORY_CHECK_INTERVAL_MS);

  // Ensure interval doesn't prevent process exit
  if (typeof interval === "object" && "unref" in interval) {
    (interval as { unref: () => void }).unref();
  }

  setMemoryCheckInterval(interval);
}

/**
 * Stop periodic memory pressure checks.
 * Should be called during shutdown or cleanup.
 */
export function stopPeriodicMemoryCheck(): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    setMemoryCheckInterval(null);
    rendererLogger.info("[RendererFactory] Stopped periodic memory check");
  }
}

/**
 * Manually trigger a memory pressure check.
 * Useful for testing or when you know memory pressure is high.
 */
export async function triggerMemoryCheck(): Promise<boolean> {
  return await checkAndEvictUnderMemoryPressure("manual");
}
