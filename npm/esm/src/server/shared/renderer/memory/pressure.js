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
import { rendererLogger } from "../../../../utils/index.js";
import { getHeapStats } from "../../../../utils/memory/index.js";
import { getEnv } from "../../../../platform/compat/process.js";
/** Parse env var as number with fallback */
function parseEnvThreshold(name, fallback) {
    const value = getEnv(name);
    if (!value)
        return fallback;
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
        rendererLogger.warn(`[MemoryPressure] Invalid ${name}=${value}, using default ${fallback}`);
        return fallback;
    }
    return parsed;
}
/** Thresholds for progressive memory management (configurable via env vars) */
const THRESHOLDS = {
    WARNING: parseEnvThreshold("MEMORY_WARNING_THRESHOLD", 65),
    HIGH: parseEnvThreshold("MEMORY_HIGH_THRESHOLD", 75),
    CRITICAL: parseEnvThreshold("MEMORY_CRITICAL_THRESHOLD", 80),
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
