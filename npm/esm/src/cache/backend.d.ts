import { type RuntimeEnv } from "../config/runtime-env.js";
/** Cache backend interface. */
export interface CacheBackend {
    /** Backend type identifier */
    readonly type: "memory" | "redis" | "api";
    /** Get a value from cache */
    get(key: string): Promise<string | null>;
    /** Get multiple values from cache (batch operation) */
    getBatch?(keys: string[]): Promise<Map<string, string | null>>;
    /** Set a value in cache with optional TTL (seconds) */
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    /** Set multiple values in cache (batch operation) */
    setBatch?(entries: Array<{
        key: string;
        value: string;
        ttl?: number;
    }>): Promise<void>;
    /** Delete a key from cache */
    del(key: string): Promise<void>;
    /** Delete multiple keys matching a pattern */
    delByPattern?(pattern: string): Promise<number>;
    /** Current entry count (only available for memory backend) */
    readonly size?: number;
}
/** Memory cache backend with TTL support. */
export declare class MemoryCacheBackend implements CacheBackend {
    readonly type: "memory";
    private store;
    private regexCache;
    private maxEntries;
    constructor(maxEntries?: number);
    get(key: string): Promise<string | null>;
    getBatch(keys: string[]): Promise<Map<string, string | null>>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    setBatch(entries: Array<{
        key: string;
        value: string;
        ttl?: number;
    }>): Promise<void>;
    del(key: string): Promise<void>;
    delByPattern(pattern: string): Promise<number>;
    clear(): void;
    get size(): number;
}
/** Redis cache backend for local development and open source deployments. */
export declare class RedisCacheBackend implements CacheBackend {
    readonly type: "redis";
    private client;
    private keyPrefix;
    constructor(keyPrefix?: string);
    private prefixKey;
    initialize(): Promise<boolean>;
    get(key: string): Promise<string | null>;
    getBatch(keys: string[]): Promise<Map<string, string | null>>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    setBatch(entries: Array<{
        key: string;
        value: string;
        ttl?: number;
    }>): Promise<void>;
    del(key: string): Promise<void>;
    delByPattern(pattern: string): Promise<number>;
}
/**
 * API cache backend for production.
 * Uses veryfront-api for centralized, project-scoped cache management.
 * Includes circuit breaker to prevent cascade failures when API is degraded.
 */
export declare class ApiCacheBackend implements CacheBackend {
    readonly type: "api";
    private apiBaseUrl;
    private keyPrefix;
    private timeoutMs;
    private env?;
    private circuitBreaker;
    constructor(options?: {
        apiBaseUrl?: string;
        keyPrefix?: string;
        timeoutMs?: number;
        /** Optional RuntimeEnv for test isolation */
        env?: RuntimeEnv;
        /** Circuit breaker name - allows isolation between different cache types */
        circuitBreakerName?: string;
    });
    private prefixKey;
    private getAuthToken;
    private getProjectSlug;
    private request;
    get(key: string): Promise<string | null>;
    getBatch(keys: string[]): Promise<Map<string, string | null>>;
    /** Helper to fetch keys individually (used as fallback when batch fails). */
    private getIndividually;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    setBatch(entries: Array<{
        key: string;
        value: string;
        ttl?: number;
    }>): Promise<void>;
    del(key: string): Promise<void>;
    delByPattern(pattern: string): Promise<number>;
}
/** Cache backend configuration. */
export interface CacheBackendConfig {
    /** Key prefix for namespacing */
    keyPrefix?: string;
    /** Max entries for memory backend */
    memoryMaxEntries?: number;
    /** Preferred backend type (auto-detected if not specified) */
    preferredBackend?: "api" | "redis" | "memory";
    /** API base URL for API backend */
    apiBaseUrl?: string;
    /** Optional RuntimeEnv for test isolation */
    env?: RuntimeEnv;
    /** Circuit breaker name for API backend isolation */
    circuitBreakerName?: string;
}
/** Check if API cache backend is available (production environment with API URL). */
export declare function isApiCacheAvailable(env?: RuntimeEnv): boolean;
/**
 * Create cache backend based on environment.
 * Preference: API (production) > Redis (local/OSS) > Memory (fallback)
 */
export declare function createCacheBackend(config?: CacheBackendConfig): Promise<CacheBackend>;
/** Convenience wrappers for common cache patterns. */
export declare const CacheBackends: {
    /** Transform cache for compiled code. */
    transform: () => Promise<CacheBackend>;
    /** File cache for file content. Keys already include "file:" prefix from buildFileCacheKeyPrefix. */
    file: () => Promise<CacheBackend>;
    /** Module cache for SSR modules. */
    module: () => Promise<CacheBackend>;
    /** Render cache for rendered pages. */
    render: () => Promise<CacheBackend>;
    /** User KV store - always uses API backend. */
    userKv: () => Promise<CacheBackend>;
    /** HTTP module cache for ESM.sh modules (cross-pod sharing).
     * Uses separate circuit breaker to prevent cascade failures from blocking recovery. */
    httpModule: () => Promise<CacheBackend>;
    /** Project CSS cache for Tailwind CSS output (cross-pod sharing). */
    projectCSS: () => Promise<CacheBackend>;
};
//# sourceMappingURL=backend.d.ts.map