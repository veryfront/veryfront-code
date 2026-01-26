/**
 * ESM Module Cache Operations
 *
 * Manages persistent module path caching for ESM module loading.
 *
 * @module build/transforms/mdx/esm-module-loader/cache
 */
import { type FileSystem } from "../../../../platform/compat/fs.js";
/**
 * Get or create the local filesystem instance.
 */
export declare function getLocalFs(): FileSystem;
/**
 * Get or load the module path cache.
 * The cache maps normalized module paths to their disk cache file paths.
 */
export declare function getModulePathCache(cacheDir: string): Promise<Map<string, string>>;
/**
 * Save the module path cache to disk.
 */
export declare function saveModulePathCache(cacheDir: string): Promise<void>;
/**
 * Clear the in-memory module path cache.
 * Called on invalidation to force re-checking disk cache.
 */
export declare function clearModulePathCache(): void;
/**
 * Invalidate specific module paths from the cache.
 * Called on selective invalidation when specific files are edited.
 * This is much faster than clearing the entire cache.
 */
export declare function invalidateModulePaths(changedPaths: string[]): void;
/**
 * Clear the persistent ESM disk cache.
 * Called when files are updated via Studio to ensure fresh content is served.
 */
export declare function clearESMDiskCache(): Promise<void>;
//# sourceMappingURL=index.d.ts.map