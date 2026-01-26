/**
 * Multi-Tier Cache Abstraction
 *
 * Generic implementation for L1 → L2 → L3 cache flows with automatic backfill.
 * This provides consistent caching behavior across the codebase:
 *
 * - L1: In-memory (fastest, per-pod, lost on restart)
 * - L2: Local disk (fast, per-pod, survives restart)
 * - L3: Distributed (Redis/API, cross-pod, shared state)
 *
 * When a cache hit occurs at a lower tier (e.g., L3), the value is automatically
 * backfilled to higher tiers (L1, L2) for faster subsequent access.
 *
 * @module cache/multi-tier
 */
/**
 * Generic cache tier interface.
 * Each tier implements async get/set operations.
 */
export interface CacheTier<T = string> {
    /** Tier name for logging/debugging */
    readonly name: string;
    /** Get a value from this tier */
    get(key: string): Promise<T | null>;
    /** Set a value in this tier */
    set(key: string, value: T, ttlSeconds?: number): Promise<void>;
    /** Delete a value from this tier */
    delete?(key: string): Promise<void>;
    /** Check if key exists (optional, uses get if not implemented) */
    has?(key: string): Promise<boolean>;
    /** Get multiple values (optional batch operation) */
    getBatch?(keys: string[]): Promise<Map<string, T | null>>;
    /** Set multiple values (optional batch operation) */
    setBatch?(entries: Array<{
        key: string;
        value: T;
        ttl?: number;
    }>): Promise<void>;
}
/**
 * Configuration for multi-tier cache.
 */
export interface MultiTierCacheConfig<T = string> {
    /** Cache name for logging */
    name: string;
    /** L1: Memory tier (optional) */
    l1?: CacheTier<T>;
    /** L2: Disk tier (optional) */
    l2?: CacheTier<T>;
    /** L3: Distributed tier (optional) */
    l3?: CacheTier<T>;
    /** Default TTL in seconds for set operations */
    defaultTtlSeconds?: number;
    /** Whether to backfill higher tiers on lower-tier hits (default: true) */
    backfillOnHit?: boolean;
    /** Whether to use fire-and-forget for backfill operations (default: true) */
    asyncBackfill?: boolean;
}
/**
 * Cache hit statistics.
 */
export interface CacheStats {
    /** Total get operations */
    gets: number;
    /** Hits at each tier */
    l1Hits: number;
    l2Hits: number;
    l3Hits: number;
    /** Total misses (no tier had the value) */
    misses: number;
    /** Set operations */
    sets: number;
    /** Backfill operations triggered */
    backfills: number;
}
/**
 * Multi-tier cache implementation.
 *
 * Provides automatic fallthrough from L1 → L2 → L3 with backfill on hits.
 *
 * @example
 * ```typescript
 * const cache = new MultiTierCache({
 *   name: "http-module",
 *   l1: new MemoryTier(),
 *   l3: await CacheBackends.httpModule(),
 *   defaultTtlSeconds: 86400,
 * });
 *
 * const value = await cache.get("my-key");
 * // If found in L3, automatically backfills L1
 * ```
 */
export declare class MultiTierCache<T = string> {
    private readonly config;
    private stats;
    constructor(config: MultiTierCacheConfig<T>);
    /**
     * Get a value from the cache.
     *
     * Checks tiers in order: L1 → L2 → L3.
     * On hit at a lower tier, backfills higher tiers.
     */
    get(key: string): Promise<T | null>;
    /**
     * Set a value in all tiers.
     *
     * Writes to all configured tiers in parallel (or sequentially if asyncBackfill=false).
     */
    set(key: string, value: T, ttlSeconds?: number): Promise<void>;
    /**
     * Delete a value from all tiers.
     */
    delete(key: string): Promise<void>;
    /**
     * Get or compute a value.
     *
     * If the key exists in any tier, returns it.
     * Otherwise, calls the compute function and stores the result in all tiers.
     */
    getOrCompute(key: string, computeFn: () => Promise<T>, ttlSeconds?: number): Promise<T>;
    /**
     * Batch get multiple values.
     *
     * Uses batch operations where available for efficiency.
     * Returns a map of key → value (null if not found).
     */
    getBatch(keys: string[]): Promise<Map<string, T | null>>;
    /**
     * Get cache statistics.
     */
    getStats(): CacheStats & {
        hitRate: number;
    };
    /**
     * Reset statistics.
     */
    resetStats(): void;
    /**
     * Backfill higher tiers with a value found at a lower tier.
     */
    private backfill;
    /**
     * Helper for individual gets when batch operation is not available.
     */
    private individualGets;
}
//# sourceMappingURL=multi-tier.d.ts.map