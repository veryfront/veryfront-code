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

/** Thresholds for progressive memory management
 * - WARNING (65%): Reduce cache TTL to slow memory growth
 * - HIGH (75%): Aggressive eviction to reclaim memory
 * - CRITICAL (80%): Reject requests to prevent OOM (lowered from 90% for safety buffer)
 */
const THRESHOLDS = {
  WARNING: 65,
  HIGH: 75,
  CRITICAL: 80,
} as const;

export function getMemoryPressure(): {
  level: MemoryPressureLevel;
  heapUsedPercent: number;
} {
  const heapUsedPercent = getHeapStats().heapUsedPercent;

  if (heapUsedPercent >= THRESHOLDS.CRITICAL) return { level: "critical", heapUsedPercent };
  if (heapUsedPercent >= THRESHOLDS.HIGH) return { level: "high", heapUsedPercent };
  if (heapUsedPercent >= THRESHOLDS.WARNING) return { level: "warning", heapUsedPercent };
  return { level: "normal", heapUsedPercent };
}

export function shouldRejectDueToMemory(): boolean {
  const { level, heapUsedPercent } = getMemoryPressure();
  if (level !== "critical") return false;

  rendererLogger.warn("[Renderer] Rejecting request - memory critical", { heapUsedPercent });
  return true;
}

export function getCacheTTLMultiplier(): number {
  const { level } = getMemoryPressure();

  if (level === "warning") return 0.5;
  if (level === "high" || level === "critical") return 0.25;
  return 1.0;
}

export function shouldEvictAggressively(): boolean {
  const { level } = getMemoryPressure();
  return level === "high" || level === "critical";
}
