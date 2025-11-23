/**
 * Vendor Bundle Cache
 *
 * Caches vendor bundles by dependency hash to avoid redundant builds.
 * Provides per-project vendor bundle management with automatic invalidation.
 */

import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import type { VendorBundleResult } from "./vendor-bundle.ts";
import { getBuildConfig } from "./config/environment.ts";

interface VendorCacheEntry {
  bundle: VendorBundleResult;
  timestamp: number;
  config: {
    reactVersion: string;
    dependencies: Record<string, string>;
  };
}

/**
 * VendorCacheManager class to encapsulate cache operations
 * Replaces global mutable cache with instance-based approach
 */
export class VendorCacheManager {
  private cache: LRUCache<string, VendorCacheEntry>;

  constructor() {
    const config = getBuildConfig();
    const disableIntervals = isLruIntervalDisabled();
    this.cache = new LRUCache<string, VendorCacheEntry>({
      maxEntries: config.cacheMaxEntries,
      ttlMs: disableIntervals ? undefined : config.cacheTTLMs,
    });
  }

  /**
   * Get cached vendor bundle
   *
   * @param key - Cache key from generateVendorCacheKey()
   * @returns Cached vendor bundle or undefined if not found
   */
  get(key: string): VendorBundleResult | undefined {
    const entry = this.cache.get(key);
    return entry?.bundle;
  }

  /**
   * Store vendor bundle in cache
   *
   * @param key - Cache key from generateVendorCacheKey()
   * @param bundle - Vendor bundle result
   * @param reactVersion - React version used
   * @param dependencies - Dependencies included
   */
  set(
    key: string,
    bundle: VendorBundleResult,
    reactVersion: string,
    dependencies: Record<string, string>,
  ): void {
    this.cache.set(key, {
      bundle,
      timestamp: Date.now(),
      config: {
        reactVersion,
        dependencies,
      },
    });
  }

  /**
   * Invalidate vendor bundle cache for a specific project
   *
   * @param projectId - Project identifier
   */
  invalidateProject(projectId: string): void {
    const prefix = `vendor:${projectId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all vendor bundle cache
   */
  clear(): void {
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
  destroy(): void {
    this.cache.destroy();
  }
}

function isLruIntervalDisabled(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) {
    return true;
  }
  try {
    return Deno.env.get("VF_DISABLE_LRU_INTERVAL") === "1";
  } catch (_error) {
    return false;
  }
}

// Default singleton instance for backward compatibility
// Applications should prefer creating their own instances
let defaultInstance: VendorCacheManager | undefined;

function _getDefaultInstance(): VendorCacheManager {
  if (!defaultInstance) {
    defaultInstance = new VendorCacheManager();
  }
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
export async function generateVendorCacheKey(
  projectId: string,
  reactVersion: string,
  dependencies: Record<string, string>,
): Promise<string> {
  // Create deterministic string from config
  const configStr = JSON.stringify({
    transformVersion: TRANSFORM_VERSION,
    react: reactVersion,
    deps: Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  });

  // Hash the config
  const encoder = new TextEncoder();
  const data = encoder.encode(configStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);

  return `vendor:${projectId}:${hash}`;
}

/**
 * Destroy the vendor cache and clean up resources
 * This function is now safe to call in production code
 */
export function destroyVendorCache(): void {
  if (defaultInstance) {
    defaultInstance.destroy();
    defaultInstance = undefined;
  }
}
