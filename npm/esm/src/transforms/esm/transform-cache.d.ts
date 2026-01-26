import { type CacheBackend } from "../../cache/backend.js";
export interface TransformCacheEntry {
    code: string;
    hash: string;
    timestamp: number;
}
export declare function initializeTransformCache(): Promise<boolean>;
export declare function isDistributedCacheEnabled(): boolean;
/** @deprecated Use initializeTransformCache instead */
export declare const initializeRedisCache: typeof initializeTransformCache;
/** @deprecated Use isDistributedCacheEnabled instead */
export declare const isRedisCacheEnabled: typeof isDistributedCacheEnabled;
export declare function generateCacheKey(filePath: string, contentHash: string, ssr?: boolean, studioEmbed?: boolean): string;
export declare function getCachedTransformAsync(key: string): Promise<TransformCacheEntry | undefined>;
export declare function getCachedTransform(key: string): TransformCacheEntry | undefined;
export declare function setCachedTransformAsync(key: string, code: string, hash: string, ttlSeconds?: number): Promise<void>;
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
export declare function getOrComputeTransform(key: string, computeFn: () => Promise<string>, ttlSeconds?: number): Promise<string>;
export declare function getTransformCacheStats(): {
    fallbackEntries: number;
    maxFallbackEntries: number;
    backend: string;
};
//# sourceMappingURL=transform-cache.d.ts.map