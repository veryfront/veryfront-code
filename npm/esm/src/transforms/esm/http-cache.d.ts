import type { ImportMapConfig } from "../../modules/import-map/types.js";
type CacheOptions = {
    cacheDir: string;
    importMap: ImportMapConfig;
    /** React version to use for esm.sh URLs (defaults to REACT_VERSION) */
    reactVersion?: string;
};
/**
 * Rewrite HTTP imports in the provided code to cached local file:// paths.
 */
export declare function cacheHttpImportsToLocal(code: string, options: CacheOptions): Promise<string>;
/**
 * Cache a specific HTTP module URL and return its local file:// path.
 * Used by server-loader.ts to cache react-dom/server and ensure the same
 * React instance is used by both components and the SSR renderer.
 *
 * @param url - The HTTP URL to cache (e.g., https://esm.sh/react-dom@18.3.1/server)
 * @param cacheDir - The cache directory path
 * @returns The local file:// URL path, or the original URL if caching fails
 */
export declare function cacheModuleToLocal(url: string, cacheDir: string): Promise<string>;
/**
 * Recover a missing HTTP bundle by looking up the code directly from the hash.
 * Used for cross-pod recovery when a file:// path points to a bundle that
 * exists in distributed cache but not on the local filesystem.
 *
 * Recovery strategy (in order of preference):
 * 1. Direct code lookup by hash (code:{hash}) - fastest, most reliable
 * 2. URL lookup then re-fetch (hash:{hash} → URL → fetch) - fallback
 *
 * @param hash - The hash from the bundle filename (e.g., "974671618" from "http-974671618.mjs")
 * @param cacheDir - The cache directory path
 * @returns true if recovery succeeded, false otherwise
 */
export declare function recoverHttpBundleByHash(hash: string, cacheDir: string): Promise<boolean>;
/**
 * Ensure all HTTP bundles exist locally before import.
 * Proactively fetches missing bundles from distributed cache.
 *
 * This is the preferred approach over fail-then-recover:
 * - Check first, don't wait for import to fail
 * - Batch fetch for efficiency
 * - Clear error messages if bundles not available
 *
 * @param bundlePaths - Array of {path, hash} for bundles to check
 * @param cacheDir - Cache directory for HTTP bundles
 * @returns Array of hashes that could not be recovered
 */
export declare function ensureHttpBundlesExist(bundlePaths: Array<{
    path: string;
    hash: string;
}>, cacheDir: string): Promise<string[]>;
export {};
//# sourceMappingURL=http-cache.d.ts.map