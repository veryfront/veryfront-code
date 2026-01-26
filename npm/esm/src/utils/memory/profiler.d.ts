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
export declare function registerCache(name: string, getStats: () => CacheStats): void;
export declare function unregisterCache(name: string): void;
export declare function getHeapStats(): HeapStats;
export declare function getCacheStats(): CacheStats[];
export declare function getMemorySnapshot(): MemorySnapshot;
export declare function forceGC(): Promise<boolean>;
export declare function startMemoryMonitoring(intervalMs?: number): void;
export declare function stopMemoryMonitoring(): void;
export declare function setHeapWarningThreshold(threshold: number): void;
export declare function clearAllCaches(): void;
export declare function checkMemoryPressure(): {
    critical: boolean;
    warning: boolean;
    heapUsedPercent: number;
};
export type { MemorySnapshot as MemorySnapshotType };
//# sourceMappingURL=profiler.d.ts.map