/**
 * Cache Stores Module
 *
 * Cache store implementations for different backends (filesystem, KV, memory, Redis).
 * Each store implements the CacheStore interface for pluggable caching strategies.
 *
 * @example
 * ```typescript
 * import { MemoryCacheStore, FilesystemCacheStore } from '@veryfront/rendering/cache/stores'
 *
 * // Memory store (fast, volatile)
 * const memStore = new MemoryCacheStore({ maxSize: 100 })
 *
 * // Filesystem store (persistent)
 * const fsStore = new FilesystemCacheStore({ cacheDir: '.cache' })
 * ```
 *
 * @module rendering/cache/stores
 */

// Filesystem cache store
export { FilesystemCacheStore, type FilesystemCacheStoreOptions } from "./filesystem-store.ts";

// KV cache store
export { KVCacheStore, type KVCacheStoreOptions } from "./kv-store.ts";

// Memory cache store
export { MemoryCacheStore, type MemoryCacheStoreOptions } from "./memory-store.ts";

// Redis cache store
export { RedisCacheStore, type RedisCacheStoreOptions } from "./redis-store.ts";
