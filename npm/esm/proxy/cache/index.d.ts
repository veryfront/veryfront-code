/**
 * Token Cache Module
 *
 * Provides configurable caching for OAuth tokens.
 * Supports in-memory (single instance) and Redis (distributed) backends.
 * Redis cache includes automatic fallback to memory when Redis is unavailable.
 */
export type { CacheOptions, CacheStats, MemoryCacheOptions, RedisCacheOptions, TokenCache, TokenCacheEntry, } from "./types.js";
export { MemoryCache } from "./memory-cache.js";
export { RedisCache } from "./redis-cache.js";
export { ResilientCache } from "./resilient-cache.js";
import type { CacheOptions, TokenCache } from "./types.js";
/**
 * Create a token cache based on configuration.
 *
 * @example
 * ```typescript
 * // In-memory cache (default)
 * const cache = createCache({ type: "memory" });
 *
 * // Redis cache for distributed deployments
 * const cache = createCache({
 *   type: "redis",
 *   options: { url: "redis://localhost:6379" }
 * });
 * ```
 */
export declare function createCache(options: CacheOptions): Promise<TokenCache>;
/**
 * Create cache from environment variables.
 *
 * Environment variables:
 * - CACHE_TYPE: "memory" or "redis" (default: "memory")
 * - REDIS_URL: Redis connection URL (required if CACHE_TYPE=redis)
 * - REDIS_PREFIX: Key prefix (default: "vf:token:")
 *
 * When CACHE_TYPE=redis, automatically wraps with ResilientCache for
 * graceful fallback to memory when Redis is unavailable.
 */
export declare function createCacheFromEnv(): Promise<TokenCache>;
//# sourceMappingURL=index.d.ts.map