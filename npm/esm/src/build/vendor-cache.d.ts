import type { VendorBundleResult } from "./vendor-bundle.js";
/**
 * VendorCacheManager class to encapsulate cache operations
 * Replaces global mutable cache with instance-based approach
 */
export declare class VendorCacheManager {
    private cache;
    constructor();
    /**
     * Get cached vendor bundle
     *
     * @param key - Cache key from generateVendorCacheKey()
     * @returns Cached vendor bundle or undefined if not found
     */
    get(key: string): VendorBundleResult | undefined;
    /**
     * Store vendor bundle in cache
     *
     * @param key - Cache key from generateVendorCacheKey()
     * @param bundle - Vendor bundle result
     * @param reactVersion - React version used
     * @param dependencies - Dependencies included
     */
    set(key: string, bundle: VendorBundleResult, reactVersion: string, dependencies: Record<string, string>): void;
    /**
     * Invalidate vendor bundle cache for a specific project
     *
     * @param projectId - Project identifier
     */
    invalidateProject(projectId: string): void;
    /**
     * Clear all vendor bundle cache
     */
    clear(): void;
    /**
     * Get cache statistics
     *
     * @returns Object with cache stats
     */
    getStats(): {
        size: number;
        maxEntries: number;
        ttlMs: number;
    };
    /**
     * Destroy the cache and clean up resources
     */
    destroy(): void;
}
/**
 * Generate cache key from vendor bundle configuration
 *
 * Strategy: Hash the React version + dependency map + transform version
 * This ensures different dependency sets get different bundles
 *
 * @param projectId - Project identifier
 * @param reactVersion - React version string
 * @param dependencies - Map of package names to versions
 * @returns Cache key string
 */
export declare function generateVendorCacheKey(projectId: string, reactVersion: string, dependencies: Record<string, string>): Promise<string>;
/**
 * Destroy the vendor cache and clean up resources
 * This function is now safe to call in production code
 */
export declare function destroyVendorCache(): void;
//# sourceMappingURL=vendor-cache.d.ts.map