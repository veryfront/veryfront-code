/**************************
 * Memory Profiler
 *
 * Advanced memory profiling utilities for monitoring heap usage,
 * tracking cache sizes, and detecting memory leaks.
 **************************/

import { rendererLogger as logger } from "#veryfront/utils";
import { getArgs, memoryUsage } from "#veryfront/platform/compat/process.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

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

let memoryCheckInterval: ReturnType<typeof setInterval> | undefined;
let lastHeapUsed = 0;
let heapGrowthWarningThreshold = 0.8;

export function registerCache(name: string, getStats: () => CacheStats): void {
  cacheRegistry.set(name, getStats);
  logger.debug(`[MemoryProfiler] Registered cache: ${name}`);
}

export function unregisterCache(name: string): void {
  cacheRegistry.delete(name);
}

export function getHeapStats(): HeapStats {
  const mem = memoryUsage();

  const usedHeapSizeMB = mem.heapUsed / (1024 * 1024);
  const totalHeapSizeMB = mem.heapTotal / (1024 * 1024);
  const heapSizeLimitMB = getConfiguredHeapLimit();
  const externalMemoryMB = mem.external / (1024 * 1024);
  const heapUsedPercent = (usedHeapSizeMB / heapSizeLimitMB) * 100;

  return {
    usedHeapSizeMB: Math.round(usedHeapSizeMB * 100) / 100,
    totalHeapSizeMB: Math.round(totalHeapSizeMB * 100) / 100,
    heapSizeLimitMB,
    externalMemoryMB: Math.round(externalMemoryMB * 100) / 100,
    heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
    rss: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
  };
}

function getConfiguredHeapLimit(env: RuntimeEnv = getRuntimeEnv()): number {
  const args = getArgs().join(" ");

  const v8FlagsMatch = args.match(/--max-old-space-size=(\d+)/);
  if (v8FlagsMatch?.[1]) {
    return parseInt(v8FlagsMatch[1], 10);
  }

  const denoV8Match = env.denoV8Flags?.match(/--max-old-space-size=(\d+)/);
  if (denoV8Match?.[1]) {
    return parseInt(denoV8Match[1], 10);
  }

  if (env.v8MaxOldSpaceSize && env.v8MaxOldSpaceSize > 0) {
    return env.v8MaxOldSpaceSize;
  }

  return 5120;
}

export function getCacheStats(): CacheStats[] {
  const stats: CacheStats[] = [];

  for (const [name, getStats] of cacheRegistry) {
    try {
      stats.push(getStats());
    } catch (error) {
      logger.warn(`[MemoryProfiler] Failed to get stats for cache ${name}:`, error);
      stats.push({ name, entries: -1 });
    }
  }

  return stats;
}

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

export async function forceGC(): Promise<boolean> {
  try {
    const size = 100 * 1024 * 1024;
    const buffer = new Uint8Array(size);
    buffer.fill(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return true;
  } catch {
    return false;
  }
}

export function startMemoryMonitoring(intervalMs = 30000): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
  }

  logger.info(`[MemoryProfiler] Starting memory monitoring (interval: ${intervalMs}ms)`);

  memoryCheckInterval = setInterval(() => {
    const snapshot = getMemorySnapshot();
    const { heap } = snapshot;

    logger.info("[MemoryProfiler] Memory status", {
      heapUsedMB: heap.usedHeapSizeMB,
      heapTotalMB: heap.totalHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      heapUsedPercent: heap.heapUsedPercent,
      rssMB: heap.rss,
      totalCacheEntries: snapshot.totalCacheEntries,
    });

    const thresholdPercent = heapGrowthWarningThreshold * 100;
    if (heap.heapUsedPercent > thresholdPercent) {
      logger.warn("[MemoryProfiler] HIGH MEMORY USAGE", {
        heapUsedPercent: heap.heapUsedPercent,
        threshold: thresholdPercent,
        caches: snapshot.caches.map((c) => `${c.name}: ${c.entries}`).join(", "),
      });
    }

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

export function stopMemoryMonitoring(): void {
  if (!memoryCheckInterval) return;

  clearInterval(memoryCheckInterval);
  memoryCheckInterval = undefined;
  logger.info("[MemoryProfiler] Memory monitoring stopped");
}

export function setHeapWarningThreshold(threshold: number): void {
  heapGrowthWarningThreshold = Math.max(0.1, Math.min(0.99, threshold));
}

export function clearAllCaches(): void {
  logger.warn("[MemoryProfiler] Clearing all registered caches");

  for (const cache of getCacheStats()) {
    logger.info(`[MemoryProfiler] Cache to clear: ${cache.name} (${cache.entries} entries)`);
  }
}

/**
 * Memory pressure thresholds - should match pressure.ts defaults for consistency.
 * Uses same env vars: MEMORY_WARNING_THRESHOLD (default: 75), MEMORY_CRITICAL_THRESHOLD (default: 80)
 */
function getMemoryThreshold(envVar: string, fallback: number): number {
  try {
    const value = typeof Deno !== "undefined" ? Deno.env.get(envVar) : undefined;
    if (!value) return fallback;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  } catch {
    return fallback;
  }
}

const PROFILER_WARNING_THRESHOLD = getMemoryThreshold("MEMORY_WARNING_THRESHOLD", 75);
const PROFILER_CRITICAL_THRESHOLD = getMemoryThreshold("MEMORY_CRITICAL_THRESHOLD", 80);

export function checkMemoryPressure(): {
  critical: boolean;
  warning: boolean;
  heapUsedPercent: number;
} {
  const heap = getHeapStats();
  const critical = heap.heapUsedPercent > PROFILER_CRITICAL_THRESHOLD;
  const warning = heap.heapUsedPercent > PROFILER_WARNING_THRESHOLD;

  if (critical) {
    logger.error("[MemoryProfiler] CRITICAL MEMORY PRESSURE", {
      heapUsedPercent: heap.heapUsedPercent,
      usedMB: heap.usedHeapSizeMB,
      limitMB: heap.heapSizeLimitMB,
      threshold: PROFILER_CRITICAL_THRESHOLD,
    });
  }

  return { critical, warning, heapUsedPercent: heap.heapUsedPercent };
}

export type { MemorySnapshot as MemorySnapshotType };
