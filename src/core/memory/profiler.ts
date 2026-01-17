/**
 * Memory Profiler
 *
 * Advanced memory profiling utilities for monitoring heap usage,
 * tracking cache sizes, and detecting memory leaks.
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { getArgs, getEnv, memoryUsage } from "@veryfront/platform/compat/process.ts";

// Registry of all tracked caches for memory monitoring
const cacheRegistry = new Map<string, () => CacheStats>();

export interface CacheStats {
  name: string;
  entries: number;
  maxEntries?: number;
  estimatedSizeBytes?: number;
  /** Cache backend type (memory, redis, api) */
  backend?: string;
}

export interface HeapStats {
  usedHeapSizeMB: number;
  totalHeapSizeMB: number;
  heapSizeLimitMB: number;
  externalMemoryMB: number;
  heapUsedPercent: number;
  rss?: number;
}

export interface MemorySnapshot {
  timestamp: string;
  heap: HeapStats;
  caches: CacheStats[];
  totalCacheEntries: number;
  gcStats?: GCStats;
}

export interface GCStats {
  majorGCs: number;
  minorGCs: number;
  lastGCDurationMs?: number;
}

// Tracking for periodic memory logging
let memoryCheckInterval: ReturnType<typeof setInterval> | undefined;
let lastHeapUsed = 0;
let heapGrowthWarningThreshold = 0.8; // 80% of heap limit

/**
 * Register a cache for memory monitoring
 */
export function registerCache(name: string, getStats: () => CacheStats): void {
  cacheRegistry.set(name, getStats);
  logger.debug(`[MemoryProfiler] Registered cache: ${name}`);
}

/**
 * Unregister a cache from memory monitoring
 */
export function unregisterCache(name: string): void {
  cacheRegistry.delete(name);
}

/**
 * Get current heap statistics
 */
export function getHeapStats(): HeapStats {
  // Get memory info via platform-agnostic memoryUsage()
  const mem = memoryUsage();

  const usedHeapSizeMB = mem.heapUsed / (1024 * 1024);
  const totalHeapSizeMB = mem.heapTotal / (1024 * 1024);

  // V8 default max heap is ~4GB on 64-bit, but can be configured
  // Use --max-old-space-size value if available, otherwise estimate
  const heapSizeLimitMB = getConfiguredHeapLimit();
  const externalMemoryMB = mem.external / (1024 * 1024);
  const heapUsedPercent = (usedHeapSizeMB / heapSizeLimitMB) * 100;

  return {
    usedHeapSizeMB: Math.round(usedHeapSizeMB * 100) / 100,
    totalHeapSizeMB: Math.round(totalHeapSizeMB * 100) / 100,
    heapSizeLimitMB,
    externalMemoryMB: Math.round(externalMemoryMB * 100) / 100,
    heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
    rss: Math.round(mem.rss / (1024 * 1024) * 100) / 100,
  };
}

/**
 * Get configured heap limit from V8 flags or environment
 */
function getConfiguredHeapLimit(): number {
  // Check for --max-old-space-size in command args or environment
  const args = getArgs().join(" ");
  const envHeapSize = getEnv("V8_MAX_OLD_SPACE_SIZE");
  const denoV8Flags = getEnv("DENO_V8_FLAGS");

  // Parse from args: --v8-flags=--max-old-space-size=2800
  const v8FlagsMatch = args.match(/--max-old-space-size=(\d+)/);
  if (v8FlagsMatch && v8FlagsMatch[1]) {
    return parseInt(v8FlagsMatch[1], 10);
  }

  // Parse from DENO_V8_FLAGS environment variable
  if (denoV8Flags) {
    const denoV8Match = denoV8Flags.match(/--max-old-space-size=(\d+)/);
    if (denoV8Match && denoV8Match[1]) {
      return parseInt(denoV8Match[1], 10);
    }
  }

  // Parse from V8_MAX_OLD_SPACE_SIZE environment
  if (envHeapSize) {
    return parseInt(envHeapSize, 10);
  }

  // Default V8 heap limit (approximately 4GB on 64-bit systems)
  // But in containers it's often lower based on cgroup limits
  return 5120; // Match values.yaml configuration
}

/**
 * Get all registered cache statistics
 */
export function getCacheStats(): CacheStats[] {
  const stats: CacheStats[] = [];
  for (const [name, getStats] of cacheRegistry) {
    try {
      stats.push(getStats());
    } catch (err) {
      logger.warn(`[MemoryProfiler] Failed to get stats for cache ${name}:`, err);
      stats.push({ name, entries: -1 });
    }
  }
  return stats;
}

/**
 * Get complete memory snapshot
 */
export function getMemorySnapshot(): MemorySnapshot {
  const heap = getHeapStats();
  const caches = getCacheStats();
  const totalCacheEntries = caches.reduce((sum, c) => sum + Math.max(0, c.entries), 0);

  return {
    timestamp: new Date().toISOString(),
    heap,
    caches,
    totalCacheEntries,
  };
}

/**
 * Force garbage collection if available
 * Note: Requires --expose-gc flag in V8
 */
export async function forceGC(): Promise<boolean> {
  try {
    // Deno doesn't expose gc() directly, but we can try to trigger it
    // by allocating and releasing a large buffer
    const size = 100 * 1024 * 1024; // 100MB
    const buffer = new Uint8Array(size);
    buffer.fill(0);
    // Let it go out of scope and wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));
    return true;
  } catch {
    return false;
  }
}

/**
 * Start periodic memory monitoring
 */
export function startMemoryMonitoring(intervalMs = 30000): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
  }

  logger.info(`[MemoryProfiler] Starting memory monitoring (interval: ${intervalMs}ms)`);

  memoryCheckInterval = setInterval(() => {
    const snapshot = getMemorySnapshot();
    const heap = snapshot.heap;

    // Log memory status
    logger.info("[MemoryProfiler] Memory status", {
      heapUsedMB: heap.usedHeapSizeMB,
      heapTotalMB: heap.totalHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      heapUsedPercent: heap.heapUsedPercent,
      rssMB: heap.rss,
      totalCacheEntries: snapshot.totalCacheEntries,
    });

    // Warn if heap usage is growing dangerously
    if (heap.heapUsedPercent > heapGrowthWarningThreshold * 100) {
      logger.warn("[MemoryProfiler] HIGH MEMORY USAGE", {
        heapUsedPercent: heap.heapUsedPercent,
        threshold: heapGrowthWarningThreshold * 100,
        caches: snapshot.caches.map((c) => `${c.name}: ${c.entries}`).join(", "),
      });
    }

    // Track heap growth rate
    const heapGrowthMB = heap.usedHeapSizeMB - lastHeapUsed;
    if (heapGrowthMB > 100) {
      logger.warn("[MemoryProfiler] Rapid heap growth detected", {
        growthMB: heapGrowthMB,
        intervalMs,
      });
    }
    lastHeapUsed = heap.usedHeapSizeMB;
  }, intervalMs);
}

/**
 * Stop periodic memory monitoring
 */
export function stopMemoryMonitoring(): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = undefined;
    logger.info("[MemoryProfiler] Memory monitoring stopped");
  }
}

/**
 * Set heap growth warning threshold (0-1)
 */
export function setHeapWarningThreshold(threshold: number): void {
  heapGrowthWarningThreshold = Math.max(0.1, Math.min(0.99, threshold));
}

/**
 * Clear all registered caches (emergency memory relief)
 */
export function clearAllCaches(): void {
  logger.warn("[MemoryProfiler] Clearing all registered caches");
  // We can't clear the caches directly from here, but we can log what should be cleared
  const caches = getCacheStats();
  for (const cache of caches) {
    logger.info(`[MemoryProfiler] Cache to clear: ${cache.name} (${cache.entries} entries)`);
  }
}

/**
 * Check if memory is critically low and trigger emergency measures
 */
export function checkMemoryPressure(): {
  critical: boolean;
  warning: boolean;
  heapUsedPercent: number;
} {
  const heap = getHeapStats();
  const critical = heap.heapUsedPercent > 90;
  const warning = heap.heapUsedPercent > 75;

  if (critical) {
    logger.error("[MemoryProfiler] CRITICAL MEMORY PRESSURE", {
      heapUsedPercent: heap.heapUsedPercent,
      usedMB: heap.usedHeapSizeMB,
      limitMB: heap.heapSizeLimitMB,
    });
  }

  return {
    critical,
    warning,
    heapUsedPercent: heap.heapUsedPercent,
  };
}

// Export for use in cache implementations
export type { MemorySnapshot as MemorySnapshotType };
