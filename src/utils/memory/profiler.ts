/**************************
 * Memory Profiler
 *
 * Advanced memory profiling utilities for monitoring heap usage,
 * tracking cache sizes, and detecting memory leaks.
 **************************/

import { rendererLogger } from "#veryfront/utils/logger/index.ts";
import { getArgs, getEnv, memoryUsage, unrefTimer } from "#veryfront/platform/compat/process.ts";

const logger = rendererLogger.component("memory-profiler");

/** Fallback V8 heap limit when no --max-old-space-size flag is set (5 GB) */
const DEFAULT_HEAP_LIMIT_MB = 5_120;

/** Default interval for periodic memory snapshots (30 seconds) */
export const DEFAULT_MEMORY_MONITORING_INTERVAL_MS = 30_000;

/** Heap growth (MB) per interval that triggers a rapid-growth warning */
const HEAP_RAPID_GROWTH_THRESHOLD_MB = 100;

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

export interface MonitoringCacheStats {
  name: string;
  entries: number;
  maxEntries?: number;
  estimatedSizeBytes?: number;
  backend?: string;
}

export interface MemoryMonitoringLogContext {
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
  heapUsedPercent: number;
  rssMB?: number;
  totalCacheEntries: number;
  topCaches: MonitoringCacheStats[];
}

export interface MemoryMonitoringEnv {
  get(key: string): string | null | undefined;
}

export interface MemoryMonitoringConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface MemoryMonitoringState {
  active: boolean;
  intervalMs: number | undefined;
}

export interface GCStats {
  majorGCs: number;
  minorGCs: number;
  lastGCDurationMs?: number;
}

let memoryCheckInterval: ReturnType<typeof setInterval> | undefined;
let memoryCheckIntervalMs: number | undefined;
let lastHeapUsed = 0;
let heapGrowthWarningThreshold = 0.8;
let pendingRapidHeapGrowth: PendingRapidHeapGrowth | undefined;

export interface PendingRapidHeapGrowth {
  baselineHeapUsedMB: number;
  observedGrowthMB: number;
}

export interface RapidHeapGrowthEvaluationInput {
  previousHeapUsedMB: number;
  currentHeapUsedMB: number;
  currentHeapUsedPercent?: number;
  pending: PendingRapidHeapGrowth | undefined;
  thresholdMB: number;
  memoryPressureWarningThresholdPercent?: number;
}

export interface RapidHeapGrowthEvaluation {
  shouldWarn: boolean;
  growthMB?: number;
  observedGrowthMB?: number;
  pending?: PendingRapidHeapGrowth;
}

export interface RapidHeapGrowthState {
  lastHeapUsedMB: number;
  pending: PendingRapidHeapGrowth | undefined;
}

export function registerCache(name: string, getStats: () => CacheStats): void {
  cacheRegistry.set(name, getStats);
  logger.debug(`Registered cache: ${name}`);
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

function getConfiguredHeapLimit(): number {
  const args = getArgs().join(" ");

  const v8FlagsMatch = args.match(/--max-old-space-size=(\d+)/);
  if (v8FlagsMatch?.[1]) return parseInt(v8FlagsMatch[1], 10);

  const denoV8Flags = getEnv("DENO_V8_FLAGS");
  const denoV8Match = denoV8Flags?.match(/--max-old-space-size=(\d+)/);
  if (denoV8Match?.[1]) return parseInt(denoV8Match[1], 10);

  const v8MaxOldSpaceSize = parseInt(getEnv("V8_MAX_OLD_SPACE_SIZE") ?? "", 10);
  if (!Number.isNaN(v8MaxOldSpaceSize) && v8MaxOldSpaceSize > 0) return v8MaxOldSpaceSize;

  return DEFAULT_HEAP_LIMIT_MB;
}

export function getCacheStats(): CacheStats[] {
  const stats: CacheStats[] = [];

  for (const [name, getStats] of cacheRegistry) {
    try {
      stats.push(getStats());
    } catch (error) {
      logger.warn(`Failed to get stats for cache ${name}:`, error);
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

function toMonitoringCacheStats(cache: CacheStats): MonitoringCacheStats {
  return {
    name: cache.name,
    entries: cache.entries,
    ...(cache.maxEntries !== undefined ? { maxEntries: cache.maxEntries } : {}),
    ...(cache.estimatedSizeBytes !== undefined
      ? { estimatedSizeBytes: cache.estimatedSizeBytes }
      : {}),
    ...(cache.backend !== undefined ? { backend: cache.backend } : {}),
  };
}

export function getTopCacheStats(caches: CacheStats[], limit = 8): MonitoringCacheStats[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return [...caches]
    .filter((cache) => cache.entries > 0)
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name))
    .slice(0, normalizedLimit)
    .map(toMonitoringCacheStats);
}

export function getMemoryMonitoringLogContext(
  snapshot: MemorySnapshot,
  topCacheLimit = 8,
): MemoryMonitoringLogContext {
  const { heap } = snapshot;

  return {
    heapUsedMB: heap.usedHeapSizeMB,
    heapTotalMB: heap.totalHeapSizeMB,
    heapLimitMB: heap.heapSizeLimitMB,
    heapUsedPercent: heap.heapUsedPercent,
    rssMB: heap.rss,
    totalCacheEntries: snapshot.totalCacheEntries,
    topCaches: getTopCacheStats(snapshot.caches, topCacheLimit),
  };
}

export function getMemoryMonitoringConfig(env: MemoryMonitoringEnv): MemoryMonitoringConfig {
  const enabled = env.get("ENABLE_MEMORY_MONITORING") === "true";
  const rawInterval = env.get("MEMORY_MONITORING_INTERVAL_MS");
  const parsedInterval = Number(rawInterval ?? DEFAULT_MEMORY_MONITORING_INTERVAL_MS);
  const intervalMs = Number.isInteger(parsedInterval) && parsedInterval > 0
    ? parsedInterval
    : DEFAULT_MEMORY_MONITORING_INTERVAL_MS;

  return { enabled, intervalMs };
}

function roundMemoryMB(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getInitialRapidHeapGrowthState(initialHeapUsedMB: number): RapidHeapGrowthState {
  return {
    lastHeapUsedMB: initialHeapUsedMB,
    pending: undefined,
  };
}

export function getRapidHeapGrowthEvaluation(
  input: RapidHeapGrowthEvaluationInput,
): RapidHeapGrowthEvaluation {
  const intervalGrowthMB = roundMemoryMB(input.currentHeapUsedMB - input.previousHeapUsedMB);

  if (input.pending) {
    const sustainedGrowthMB = roundMemoryMB(
      input.currentHeapUsedMB - input.pending.baselineHeapUsedMB,
    );
    if (sustainedGrowthMB > input.thresholdMB) {
      if (
        input.currentHeapUsedPercent !== undefined &&
        input.memoryPressureWarningThresholdPercent !== undefined &&
        input.currentHeapUsedPercent <= input.memoryPressureWarningThresholdPercent
      ) {
        return {
          shouldWarn: false,
          pending: input.pending,
        };
      }

      return {
        shouldWarn: true,
        growthMB: sustainedGrowthMB,
        observedGrowthMB: input.pending.observedGrowthMB,
      };
    }
    return { shouldWarn: false };
  }

  if (intervalGrowthMB > input.thresholdMB) {
    return {
      shouldWarn: false,
      pending: {
        baselineHeapUsedMB: input.previousHeapUsedMB,
        observedGrowthMB: intervalGrowthMB,
      },
    };
  }

  return { shouldWarn: false };
}

export function getMemoryMonitoringState(): MemoryMonitoringState {
  return {
    active: memoryCheckInterval !== undefined,
    intervalMs: memoryCheckIntervalMs,
  };
}

export async function forceGC(): Promise<boolean> {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (typeof gc !== "function") {
    // GC not exposed; pass --v8-flags=--expose-gc to enable
    return false;
  }

  try {
    gc();
    return true;
  } catch (error) {
    logger.debug("Exposed garbage collection failed", { error });
    return false;
  }
}

export function startMemoryMonitoring(intervalMs = DEFAULT_MEMORY_MONITORING_INTERVAL_MS): void {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Memory monitoring interval must be a positive integer");
  }

  if (memoryCheckInterval) clearInterval(memoryCheckInterval);

  logger.info(`Starting memory monitoring (interval: ${intervalMs}ms)`);
  memoryCheckIntervalMs = intervalMs;
  const rapidGrowthState = getInitialRapidHeapGrowthState(getHeapStats().usedHeapSizeMB);
  lastHeapUsed = rapidGrowthState.lastHeapUsedMB;
  pendingRapidHeapGrowth = rapidGrowthState.pending;

  memoryCheckInterval = setInterval(() => {
    try {
      const snapshot = getMemorySnapshot();
      const { heap } = snapshot;
      const monitoringContext = getMemoryMonitoringLogContext(snapshot);

      logger.info("Memory status", monitoringContext);

      const thresholdPercent = heapGrowthWarningThreshold * 100;
      if (heap.heapUsedPercent > thresholdPercent) {
        logger.warn("HIGH MEMORY USAGE", {
          heapUsedPercent: heap.heapUsedPercent,
          threshold: thresholdPercent,
          topCaches: monitoringContext.topCaches,
          caches: snapshot.caches.map((c) => `${c.name}: ${c.entries}`).join(", "),
        });
      }

      const rapidGrowthEvaluation = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: lastHeapUsed,
        currentHeapUsedMB: heap.usedHeapSizeMB,
        currentHeapUsedPercent: heap.heapUsedPercent,
        pending: pendingRapidHeapGrowth,
        thresholdMB: HEAP_RAPID_GROWTH_THRESHOLD_MB,
        memoryPressureWarningThresholdPercent: thresholdPercent,
      });
      pendingRapidHeapGrowth = rapidGrowthEvaluation.pending;
      if (rapidGrowthEvaluation.shouldWarn) {
        logger.warn("Rapid heap growth detected", {
          growthMB: rapidGrowthEvaluation.growthMB,
          observedGrowthMB: rapidGrowthEvaluation.observedGrowthMB,
          intervalMs,
          topCaches: monitoringContext.topCaches,
        });
      }

      lastHeapUsed = heap.usedHeapSizeMB;
    } catch (error) {
      logger.warn("Memory monitoring sample failed", { error });
    }
  }, intervalMs);
  unrefTimer(memoryCheckInterval);
}

export function startConfiguredMemoryMonitoring(env: MemoryMonitoringEnv): MemoryMonitoringConfig {
  const config = getMemoryMonitoringConfig(env);
  if (!config.enabled) return config;

  startMemoryMonitoring(config.intervalMs);
  logger.info("Memory monitoring enabled", { intervalMs: config.intervalMs });

  const initialSnapshot = getMemorySnapshot();
  logger.info("Initial memory state", {
    heapUsedMB: initialSnapshot.heap.usedHeapSizeMB,
    heapLimitMB: initialSnapshot.heap.heapSizeLimitMB,
    cacheCount: initialSnapshot.caches.length,
  });

  return config;
}

export function stopMemoryMonitoring(): void {
  if (!memoryCheckInterval) return;

  clearInterval(memoryCheckInterval);
  memoryCheckInterval = undefined;
  memoryCheckIntervalMs = undefined;
  pendingRapidHeapGrowth = undefined;
  logger.info("Memory monitoring stopped");
}

export function setHeapWarningThreshold(threshold: number): void {
  if (!Number.isFinite(threshold)) {
    throw new RangeError("Heap warning threshold must be finite");
  }
  heapGrowthWarningThreshold = Math.max(0.1, Math.min(0.99, threshold));
}

/**
 * Memory pressure thresholds - should match pressure.ts defaults for consistency.
 * Uses same env vars: MEMORY_WARNING_THRESHOLD (default: 75), MEMORY_CRITICAL_THRESHOLD (default: 80)
 */
function getMemoryThreshold(envVar: string, fallback: number): number {
  try {
    const value = getEnv(envVar);
    if (!value) return fallback;

    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;

    return parsed;
  } catch (_) {
    /* expected: Deno.env.get may fail without --allow-env */
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
  const heapUsedPercent = heap.heapUsedPercent;

  const critical = heapUsedPercent > PROFILER_CRITICAL_THRESHOLD;
  const warning = heapUsedPercent > PROFILER_WARNING_THRESHOLD;

  if (critical) {
    logger.error("CRITICAL MEMORY PRESSURE", {
      heapUsedPercent,
      usedMB: heap.usedHeapSizeMB,
      limitMB: heap.heapSizeLimitMB,
      threshold: PROFILER_CRITICAL_THRESHOLD,
    });
  }

  return { critical, warning, heapUsedPercent };
}

export type { MemorySnapshot as MemorySnapshotType };
