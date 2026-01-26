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
import { rendererLogger } from "../../../../utils/index.js";
import { getHeapStats } from "../../../../utils/memory/index.js";
/** Thresholds for progressive memory management */
const THRESHOLDS = {
    WARNING: 70,
    HIGH: 80,
    CRITICAL: 90,
};
export function getMemoryPressure() {
    const heapUsedPercent = getHeapStats().heapUsedPercent;
    if (heapUsedPercent >= THRESHOLDS.CRITICAL)
        return { level: "critical", heapUsedPercent };
    if (heapUsedPercent >= THRESHOLDS.HIGH)
        return { level: "high", heapUsedPercent };
    if (heapUsedPercent >= THRESHOLDS.WARNING)
        return { level: "warning", heapUsedPercent };
    return { level: "normal", heapUsedPercent };
}
export function shouldRejectDueToMemory() {
    const { level, heapUsedPercent } = getMemoryPressure();
    if (level !== "critical")
        return false;
    rendererLogger.warn("[Renderer] Rejecting request - memory critical", { heapUsedPercent });
    return true;
}
export function getCacheTTLMultiplier() {
    const { level } = getMemoryPressure();
    if (level === "warning")
        return 0.5;
    if (level === "high" || level === "critical")
        return 0.25;
    return 1.0;
}
export function shouldEvictAggressively() {
    const { level } = getMemoryPressure();
    return level === "high" || level === "critical";
}
