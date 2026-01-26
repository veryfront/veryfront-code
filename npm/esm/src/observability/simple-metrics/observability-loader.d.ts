/**
 * Lazy-loading observability metrics
 * @module
 */
import type { ObservabilityMetrics } from "./types.js";
/**
 * Get observability metrics with lazy loading
 *
 * @returns Observability metrics instance or null if unavailable
 *
 * @example
 * ```ts
 * const obs = await getObservabilityMetrics()
 * obs?.recordRender(100)
 * ```
 */
export declare function getObservabilityMetrics(): Promise<ObservabilityMetrics | null>;
/**
 * Reset observability loader state (useful for testing)
 */
export declare function resetObservabilityLoader(): void;
//# sourceMappingURL=observability-loader.d.ts.map