/**
 * Memory Pressure Management
 *
 * Progressive throttling to prevent OOM conditions:
 * - 70%: Warning, reduce cache TTL
 * - 80%: High pressure, start aggressive eviction
 * - 90%: Critical, reject requests
 *
 * @module server/shared/renderer/memory/pressure
 */

import { rendererLogger } from "#veryfront/utils";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";

export type MemoryPressureLevel = "normal" | "warning" | "high" | "critical";

/** Thresholds for progressive memory management */
const THRESHOLDS = {
  WARNING: 70,
  HIGH: 80,
  CRITICAL: 90,
} as const;

/**
 * Get current memory pressure level.
 */
export function getMemoryPressure(): {
  level: MemoryPressureLevel;
  heapUsedPercent: number;
} {
  const heap = getHeapStats();
  const percent = heap.heapUsedPercent;

  if (percent >= THRESHOLDS.CRITICAL) return { level: "critical", heapUsedPercent: percent };
  if (percent >= THRESHOLDS.HIGH) return { level: "high", heapUsedPercent: percent };
  if (percent >= THRESHOLDS.WARNING) return { level: "warning", heapUsedPercent: percent };
  return { level: "normal", heapUsedPercent: percent };
}

/**
 * Check if memory is too high to safely process a request.
 * Returns true if the request should be rejected to prevent OOM.
 */
export function shouldRejectDueToMemory(): boolean {
  const { level, heapUsedPercent } = getMemoryPressure();
  if (level === "critical") {
    rendererLogger.warn("[Renderer] Rejecting request - memory critical", { heapUsedPercent });
    return true;
  }
  return false;
}

/**
 * Get recommended cache TTL multiplier based on memory pressure.
 * Returns 1.0 for normal, 0.5 for warning, 0.25 for high pressure.
 */
export function getCacheTTLMultiplier(): number {
  const { level } = getMemoryPressure();
  if (level === "high" || level === "critical") return 0.25;
  if (level === "warning") return 0.5;
  return 1.0;
}

/**
 * Check if aggressive cache eviction should be triggered.
 */
export function shouldEvictAggressively(): boolean {
  const { level } = getMemoryPressure();
  return level === "high" || level === "critical";
}
