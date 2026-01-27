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
/**
 * Look up a module in the MDX-ESM cache.
 *
 * This allows other loaders (like SSR loader) to reuse modules that
 * MDX-ESM has already transformed and cached, preventing duplicate
 * module instances (which breaks React context, etc.).
 *
 * @param filePath - Project-relative file path like "lib/ChatContext.tsx"
 * @param cacheDir - The MDX-ESM cache directory for this project/contentSource
 * @param projectDir - Project directory to strip from absolute paths
 * @param contentHash - Optional content hash to validate cached file freshness
 * @returns The cached file path if found and valid, null otherwise
 */
export declare function lookupMdxEsmCache(filePath: string, cacheDir: string, projectDir?: string, contentHash?: string): Promise<string | null>;
//# sourceMappingURL=index.d.ts.map