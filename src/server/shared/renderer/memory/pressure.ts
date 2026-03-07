/**
 * Memory Pressure Management
 *
 * Progressive throttling to prevent OOM conditions:
 * - WARNING: Reduce cache TTL to slow memory growth
 * - HIGH: Aggressive eviction to reclaim memory
 * - CRITICAL: Reject requests to prevent OOM
 *
 * Thresholds are configurable via environment variables:
 * - MEMORY_WARNING_THRESHOLD (default: 65)
 * - MEMORY_HIGH_THRESHOLD (default: 75)
 * - MEMORY_CRITICAL_THRESHOLD (default: 80)
 *
 * @module server/shared/renderer/memory/pressure
 */

import { rendererLogger } from "#veryfront/utils";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";
import { getEnvNumber, getEnvString } from "#veryfront/compat/process.ts";

const memoryPressureLog = rendererLogger.component("memory-pressure");
const rendererLog = rendererLogger.component("renderer");

type MemoryPressureLevel = "normal" | "warning" | "high" | "critical";

function parseEnvThreshold(name: string, fallback: number): number {
  const value = getEnvString(name);
  if (!value) return fallback;

  const parsed = getEnvNumber(name);
  if (parsed !== undefined && !Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) {
    return parsed;
  }

  memoryPressureLog.warn(`Invalid ${name}=${value}, using default ${fallback}`);
  return fallback;
}

const THRESHOLDS = {
  WARNING: parseEnvThreshold("MEMORY_WARNING_THRESHOLD", 65),
  HIGH: parseEnvThreshold("MEMORY_HIGH_THRESHOLD", 75),
  CRITICAL: parseEnvThreshold("MEMORY_CRITICAL_THRESHOLD", 80),
};

function getMemoryPressure(): { level: MemoryPressureLevel; heapUsedPercent: number } {
  const { heapUsedPercent } = getHeapStats();

  if (heapUsedPercent >= THRESHOLDS.CRITICAL) return { level: "critical", heapUsedPercent };
  if (heapUsedPercent >= THRESHOLDS.HIGH) return { level: "high", heapUsedPercent };
  if (heapUsedPercent >= THRESHOLDS.WARNING) return { level: "warning", heapUsedPercent };

  return { level: "normal", heapUsedPercent };
}

export function shouldRejectDueToMemory(): boolean {
  const { level, heapUsedPercent } = getMemoryPressure();
  if (level !== "critical") return false;

  rendererLog.warn("Rejecting request - memory critical", { heapUsedPercent });
  return true;
}
