import { type CacheBackend } from "../../cache/backend.js";
export interface TransformCacheEntry {
    code: string;
    hash: string;
    timestamp: number;
    /** ID of the bundle manifest tracking HTTP bundles for this transform */
    bundleManifestId?: string;
}
export declare function initializeTransformCache(): Promise<boolean>;
export declare function isDistributedCacheEnabled(): boolean;
export interface CacheKeyOptions {
    depsHash?: string;
    configHash?: string;
    projectId?: string;
}
export declare function generateCacheKey(filePath: string, contentHash: string, ssr?: boolean, studioEmbed?: boolean, options?: CacheKeyOptions): string;
export declare function getCachedTransformAsync(key: string): Promise<TransformCacheEntry | undefined>;
export declare function getCachedTransform(key: string): TransformCacheEntry | undefined;
export declare function setCachedTransformAsync(key: string, code: string, hash: string, ttlSeconds?: number, bundleManifestId?: string): Promise<void>;
export declare function setCachedTransform(key: string, code: string, hash: string, ttlSeconds?: number): void;
export declare function destroyTransformCache(): void;
/**
 * Get the underlying distributed cache backend.
 *
 * This is exposed for callers that need direct access to the distributed
 * cache (e.g., MDX module-fetcher that stores raw code strings instead of
 * TransformCacheEntry JSON). Ensures initialization happens only once.
 *
 * Returns null if distributed cache is not available (memory-only mode).
 */
export declare function getDistributedTransformBackend(): Promise<CacheBackend | null>;
/** Result from getOrComputeTransform including metadata */
export interface TransformCacheResult {
    code: string;
    /** Bundle manifest ID if the cached entry has one (for manifest-based validation) */
    bundleManifestId?: string;
    /** Whether this was a cache hit */
    cacheHit: boolean;
}
/**
 * Get a cached transform or compute it if not found.
 *
 * This is the preferred way to use the transform cache - it handles:
 * - Cache lookup (distributed first, then local fallback)
 * - Compute on miss
 * - Cache storage on compute
 *
 * @param key - Cache key (use generateCacheKey to build it)
 * @param computeFn - Function to compute the transform if not cached
 * @param ttlSeconds - TTL for the cached entry
 * @returns The cached or computed code
 */
export declare function getOrComputeTransform(key: string, computeFn: () => Promise<string>, ttlSeconds?: number): Promise<TransformCacheResult>;
export declare function getTransformCacheStats(): {
    fallbackEntries: number;
    maxFallbackEntries: number;
    backend: string;
};
export interface WarmupEntry {
    key: string;
    code: string;
    hash: string;
    bundleManifestId?: string;
}
export interface WarmupResult {
    success: number;
    failed: number;
    skipped: number;
    durationMs: number;
}
/**
 * Warm up the transform cache with pre-computed entries.
 *
 * This function is designed to be called during deployment to pre-populate
 * the distributed cache, reducing P99 latency for cold starts. Each pod that
 * starts will have immediate access to cached transforms.
 *
 * @param entries - Array of transform entries to warm up
 * @param ttlSeconds - TTL for the cached entries (default: 1 hour for warmup)
 * @returns Summary of warmup results
 */
export declare function warmupTransformCache(entries: WarmupEntry[], ttlSeconds?: number): Promise<WarmupResult>;
/**
 * Pre-warm the cache for a specific project by fetching known hot paths.
 *
 * This is a convenience function that can be called during pod startup
 * to ensure commonly-accessed transforms are cached locally.
 *
 * @param projectId - The project ID to warm up
 * @param filePaths - Array of file paths to warm up
 * @returns Number of entries pre-warmed
 */
export declare function prewarmProjectTransforms(projectId: string, filePaths: string[]): Promise<number>;
//# sourceMappingURL=transform-cache.d.ts.map