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
export type MemoryPressureLevel = "normal" | "warning" | "high" | "critical";
export declare function getMemoryPressure(): {
    level: MemoryPressureLevel;
    heapUsedPercent: number;
};
export declare function shouldRejectDueToMemory(): boolean;
export declare function getCacheTTLMultiplier(): number;
export declare function shouldEvictAggressively(): boolean;
//# sourceMappingURL=pressure.d.ts.map