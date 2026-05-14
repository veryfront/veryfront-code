/**
 * Contract interface for key-value cache stores.
 *
 * No default first-party implementation is currently shipped.
 *
 * @module extensions/cache/cache-store
 */

/**
 * CacheStore contract interface.
 *
 * Implementations provide key-value caching with optional TTL support.
 */
export interface CacheStore {
  /** Retrieve a cached value by key. Returns `undefined` on miss. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Store a value under the given key with an optional TTL in seconds. */
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
  /** Delete a cached entry. */
  delete(key: string): Promise<void>;
  /** Check whether a key exists in the cache. */
  has(key: string): Promise<boolean>;
  /** Remove all entries from the cache. */
  clear(): Promise<void>;
  /** Close connections and release resources. */
  disconnect?(): Promise<void>;
}
