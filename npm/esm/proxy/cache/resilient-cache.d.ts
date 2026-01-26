/**
 * Resilient Token Cache
 *
 * Wraps a primary cache (Redis) with a fallback cache (Memory).
 * Automatically falls back to memory cache when Redis operations fail.
 * Provides graceful degradation instead of hard failures.
 */
import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.js";
export declare class ResilientCache implements TokenCache {
    private primary;
    private fallback;
    private usingFallback;
    private failureCount;
    private circuitOpenedAt;
    constructor(primary: TokenCache, fallback: TokenCache);
    /**
     * Check if we should try primary again after circuit was opened.
     */
    private shouldTryPrimary;
    /**
     * Record a successful primary operation - reset failure state.
     */
    private recordSuccess;
    /**
     * Record a primary failure - may trigger fallback.
     */
    private recordFailure;
    get(key: string): Promise<TokenCacheEntry | null>;
    set(key: string, entry: TokenCacheEntry): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    has(key: string): Promise<boolean>;
    stats(): Promise<CacheStats>;
    close(): Promise<void>;
    /**
     * Get current resilience status for debugging/health checks.
     */
    getStatus(): {
        usingFallback: boolean;
        failureCount: number;
        circuitOpenedAt: number | null;
    };
}
//# sourceMappingURL=resilient-cache.d.ts.map