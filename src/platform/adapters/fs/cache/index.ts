/**
 * Fs - Cache
 *
 * @module platform/adapters/fs/cache
 */

export { FileCache } from "./file-cache.ts";
export { createFileCache } from "./factory.ts";
export { estimateSize } from "./size-estimator.ts";
export { LRUTracker } from "./lru-tracker.ts";
export type { CacheEntry, CacheStats, FileCacheOptions } from "./types.ts";
