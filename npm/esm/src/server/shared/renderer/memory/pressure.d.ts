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
export type MemoryPressureLevel = "normal" | "warning" | "high" | "critical";
export declare function getMemoryPressure(): {
    level: MemoryPressureLevel;
    heapUsedPercent: number;
};
export declare function shouldRejectDueToMemory(): boolean;
export declare function getCacheTTLMultiplier(): number;
export declare function shouldEvictAggressively(): boolean;
//# sourceMappingURL=pressure.d.ts.map