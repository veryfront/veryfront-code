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
import { clearHttpBundleCaches } from "#veryfront/transforms/esm/http-cache-state.ts";

const memoryPressureLog = rendererLogger.component("memory-pressure");
const rendererLog = rendererLogger.component("renderer");

type MemoryPressureLevel = "normal" | "warning" | "high" | "critical";

/** Minimum interval between cache evictions to avoid thrashing (5 seconds) */
const MIN_EVICTION_INTERVAL_MS = 5_000;

/** Track last eviction time to prevent thrashing */
let lastEvictionTime = 0;

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

/**
 * Evict caches when memory pressure is high or critical.
 * Returns true if eviction was performed.
 */
function evictCachesIfNeeded(level: MemoryPressureLevel, heapUsedPercent: number): boolean {
  if (level !== "high" && level !== "critical") return false;

  const now = Date.now();
  if (now - lastEvictionTime < MIN_EVICTION_INTERVAL_MS) return false;

  lastEvictionTime = now;

  const entriesCleared = clearHttpBundleCaches();

  memoryPressureLog.warn("Evicted caches due to memory pressure", {
    level,
    heapUsedPercent,
    entriesCleared,
  });

  return true;
}

export function shouldRejectDueToMemory(): boolean {
  const { level, heapUsedPercent } = getMemoryPressure();

  // Proactively evict caches when memory pressure is high or critical
  evictCachesIfNeeded(level, heapUsedPercent);

  if (level !== "critical") return false;

  rendererLog.warn("Rejecting request - memory critical", { heapUsedPercent });
  return true;
}

/**
 * Get current memory pressure level for use by the worker pool
 * to decide whether to evict idle workers.
 */
export function getMemoryPressureLevel(): MemoryPressureLevel {
  return getMemoryPressure().level;
}

/**
 * Check memory pressure and evict caches if needed.
 * Can be called periodically (e.g., from memory monitoring) to proactively
 * reclaim memory before requests start failing.
 */
export function checkAndEvictCaches(): { level: MemoryPressureLevel; evicted: boolean } {
  const { level, heapUsedPercent } = getMemoryPressure();
  const evicted = evictCachesIfNeeded(level, heapUsedPercent);
  return { level, evicted };
}
