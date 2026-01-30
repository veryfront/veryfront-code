import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { LayoutItem } from "../../../types/index.js";
/**
 * Clear the layout discovery cache.
 * Call this when config or layout files change to ensure HMR works correctly.
 * @param projectDir - Optional: clear only entries for a specific project
 */
export declare function clearLayoutDiscoveryCache(projectDir?: string): void;
/**
 * Get cache statistics for monitoring.
 */
export declare function getLayoutDiscoveryCacheStats(): {
    size: number;
    maxSize: number;
};
export declare function discoverNestedLayouts(pageFilePath: string, rootDir: string, projectDir: string, adapter: RuntimeAdapter): Promise<LayoutItem[]>;
//# sourceMappingURL=discovery.d.ts.map