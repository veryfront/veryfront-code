import {
  type CacheStats,
  checkMemoryPressure,
  forceGC,
  getCacheStats,
  getHeapStats,
  getMemorySnapshot,
  type HeapStats,
  type MonitoringCacheStats,
} from "#veryfront/utils/memory/index.ts";

const GC_SETTLE_DELAY_MS = 200;

export interface GarbageCollectionDependencies {
  forceGC(): Promise<boolean>;
  getHeapStats(): HeapStats;
  now(): Date;
  waitForSettle(signal?: AbortSignal): Promise<void>;
}

const garbageCollectionDependencies: GarbageCollectionDependencies = {
  forceGC,
  getHeapStats,
  now: () => new Date(),
  waitForSettle: (signal) => waitForDelay(GC_SETTLE_DELAY_MS, signal),
};

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Memory measurement was aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException("Memory measurement was aborted", "AbortError"));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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

export function getFullMemorySnapshot(): Record<string, unknown> {
  const snapshot = getMemorySnapshot();
  return {
    ...snapshot,
    caches: snapshot.caches.map(toMonitoringCacheStats),
  };
}

export function getHeapSnapshot(): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    heap: getHeapStats(),
  };
}

export function getCacheSnapshot(): Record<string, unknown> {
  const caches = getCacheStats().map(toMonitoringCacheStats);
  return {
    timestamp: new Date().toISOString(),
    caches,
    totalEntries: caches.reduce((sum, cache) => sum + Math.max(0, cache.entries), 0),
  };
}

export async function collectGarbageSnapshot(
  dependencies: GarbageCollectionDependencies = garbageCollectionDependencies,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const before = dependencies.getHeapStats();
  const gcTriggered = await dependencies.forceGC();
  if (gcTriggered) await dependencies.waitForSettle(signal);
  const after = dependencies.getHeapStats();
  const freedMB = Math.max(
    0,
    Math.round((before.usedHeapSizeMB - after.usedHeapSizeMB) * 100) / 100,
  );

  return {
    timestamp: dependencies.now().toISOString(),
    gcTriggered,
    before,
    after,
    freedMB,
  };
}

export function getMemoryPressureRecommendations(
  pressure: { critical: boolean; warning: boolean },
): string[] {
  if (pressure.critical) {
    return [
      "Restart the runtime process if memory pressure remains critical",
      "Clear caches that can be safely rebuilt",
      "Inspect recent changes for retained objects",
    ];
  }
  if (pressure.warning) {
    return [
      "Monitor memory usage",
      "Clear large caches that can be safely rebuilt",
      "Review cache capacity and expiration settings",
    ];
  }
  return ["Memory usage is within configured thresholds"];
}

export function getMemoryPressureSnapshot(): Record<string, unknown> {
  const pressure = checkMemoryPressure();
  return {
    timestamp: new Date().toISOString(),
    ...pressure,
    heap: getHeapStats(),
    recommendations: getMemoryPressureRecommendations(pressure),
  };
}
