/**
 * Vendor Bundle Cache
 *
 * Caches vendor bundles by dependency hash to avoid redundant builds.
 * Provides per-project vendor bundle management with automatic invalidation.
 */
import * as dntShim from "../../_dnt.shims.js";
import { getDisableLruIntervalEnv } from "../config/env.js";
import { LRUCache } from "../utils/lru-wrapper.js";
import { getBuildConfig } from "./config/environment.js";
/**
 * VendorCacheManager class to encapsulate cache operations
 * Replaces global mutable cache with instance-based approach
 */
export class VendorCacheManager {
    cache;
    constructor() {
        const config = getBuildConfig();
        this.cache = new LRUCache({
            maxEntries: config.cacheMaxEntries,
            ttlMs: isLruIntervalDisabled() ? undefined : config.cacheTTLMs,
        });
    }
    /**
     * Get cached vendor bundle
     *
     * @param key - Cache key from generateVendorCacheKey()
     * @returns Cached vendor bundle or undefined if not found
     */
    get(key) {
        return this.cache.get(key)?.bundle;
    }
    /**
     * Store vendor bundle in cache
     *
     * @param key - Cache key from generateVendorCacheKey()
     * @param bundle - Vendor bundle result
     * @param reactVersion - React version used
     * @param dependencies - Dependencies included
     */
    set(key, bundle, reactVersion, dependencies) {
        this.cache.set(key, {
            bundle,
            timestamp: Date.now(),
            config: { reactVersion, dependencies },
        });
    }
    /**
     * Invalidate vendor bundle cache for a specific project
     *
     * @param projectId - Project identifier
     */
    invalidateProject(projectId) {
        const prefix = `vendor:${projectId}:`;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix))
                this.cache.delete(key);
        }
    }
    /**
     * Clear all vendor bundle cache
     */
    clear() {
        this.cache.clear();
    }
    /**
     * Get cache statistics
     *
     * @returns Object with cache stats
     */
    getStats() {
        const config = getBuildConfig();
        return {
            size: this.cache.size,
            maxEntries: config.cacheMaxEntries,
            ttlMs: config.cacheTTLMs,
        };
    }
    /**
     * Destroy the cache and clean up resources
     */
    destroy() {
        this.cache.destroy();
    }
}
function isLruIntervalDisabled() {
    const globalFlag = dntShim.dntGlobalThis.__vfDisableLruInterval;
    return globalFlag === true || getDisableLruIntervalEnv();
}
// Default singleton instance for backward compatibility
// Applications should prefer creating their own instances
let defaultInstance;
function _getDefaultInstance() {
    defaultInstance ??= new VendorCacheManager();
    return defaultInstance;
}
/**
 * Vendor bundle transform version
 *
 * **IMPORTANT**: Increment this version number whenever you change:
 * - Vendor bundle packages (adding/removing React, third-party libs)
 * - esbuild bundling configuration for vendor bundle
 * - React version pinned in vendor bundle
 * - Package versions in vendor bundle
 * - Bundle format or structure
 *
 * Version History:
 * - v3: Updated React 18.3.1 imports, removed ?pin parameter
 * - v2: Added transform version to cache key
 * - v1: Initial version
 *
 * Incrementing this version invalidates all cached vendor bundles,
 * ensuring projects get the latest vendor bundle without manual cache clearing.
 */
const TRANSFORM_VERSION = "3";
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
export async function generateVendorCacheKey(projectId, reactVersion, dependencies) {
    const configStr = JSON.stringify({
        transformVersion: TRANSFORM_VERSION,
        react: reactVersion,
        deps: Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
    });
    const data = new TextEncoder().encode(configStr);
    const hashBuffer = await dntShim.crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
    return `vendor:${projectId}:${hash}`;
}
/**
 * Destroy the vendor cache and clean up resources
 * This function is now safe to call in production code
 */
export function destroyVendorCache() {
    defaultInstance?.destroy();
    defaultInstance = undefined;
}
