/**
 * File Cache - Backend-Abstracted Architecture
 *
 * Caches file content with secure multi-tenant support.
 *
 * Strategy:
 * - Uses CacheBackend abstraction for backend selection
 * - API Mode (production): Uses veryfront-api for centralized cache
 * - Redis Mode (local dev/open source): Direct Redis access
 * - Memory Mode (fallback): In-memory cache
 *
 * Security: In production, renderer has no Redis credentials.
 * All cache access goes through the API which enforces tenant isolation.
 */
import type { CacheStats, FileCacheOptions } from "./types.js";
/**
 * Initialize file cache backend.
 * Call this at startup if you want to enable distributed caching.
 */
export declare function initializeFileCacheBackend(): Promise<boolean>;
/**
 * Check if distributed caching is enabled for file cache.
 */
export declare function isFileCacheDistributedEnabled(): boolean;
/** @deprecated Use initializeFileCacheBackend instead */
export declare const initializeFileCacheRedis: typeof initializeFileCacheBackend;
/** @deprecated Use isFileCacheDistributedEnabled instead */
export declare const isFileCacheRedisEnabled: typeof isFileCacheDistributedEnabled;
/**
 * FileCache - Backend-First with Local Fallback
 *
 * When backend is available: Uses backend (API/Redis)
 * When backend unavailable: Small memory fallback for local dev
 */
export declare class FileCache {
    private fallbackCache;
    private fallbackMemoryUsed;
    private options;
    private hits;
    private misses;
    constructor(options?: FileCacheOptions);
    private isDistributed;
    private getBackend;
    /**
     * Synchronous get - only checks fallback cache (for local dev without backend).
     * In production with backend, use getAsync instead.
     */
    get<T>(key: string): T | undefined;
    /**
     * Async get - checks backend (primary) or fallback memory cache.
     * Uses request-scoped batching for API backend to reduce N+1 queries.
     */
    getAsync<T>(key: string): Promise<T | undefined>;
    /**
     * Synchronous set - only writes to fallback cache (for local dev without backend).
     * In production with backend, use setAsync instead.
     */
    set<T>(key: string, value: T): void;
    /**
     * Async set - writes to backend (primary) or fallback memory cache.
     */
    setAsync<T>(key: string, value: T): Promise<void>;
    /** Write to fallback memory cache with size check and eviction. */
    private setToFallback;
    has(key: string): boolean;
    delete(key: string): boolean;
    deleteByPrefix(prefix: string): number;
    deleteByPrefixAsync(prefix: string): Promise<number>;
    deleteByPrefixAndSuffix(prefix: string, suffix: string): number;
    deleteByPrefixAndSuffixAsync(prefix: string, suffix: string): Promise<number>;
    clear(): void;
    stats(): CacheStats & {
        backend: string;
    };
    evictExpired(): number;
    private evictFallbackIfNeeded;
}
//# sourceMappingURL=file-cache.d.ts.map