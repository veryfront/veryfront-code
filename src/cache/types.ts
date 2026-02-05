/**
 * Cache Backend Type Definitions
 *
 * This file contains the core types for the cache system.
 * Separated from implementation to avoid circular dependencies.
 *
 * @module cache/types
 */

// Re-export schema types
export type { CacheBackendType, CacheSetBatchEntry } from "./schemas/index.ts";

// Import for use in interface
import type { CacheBackendType, CacheSetBatchEntry } from "./schemas/index.ts";

/**
 * Interface for cache backends (memory, redis, api).
 * All cache backends must implement this interface.
 */
export interface CacheBackend {
  /** Backend type identifier */
  readonly type: CacheBackendType;

  /**
   * Get a value from the cache.
   * @param key - Cache key
   * @returns The cached value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Get multiple values from the cache in a single batch.
   * @param keys - Array of cache keys
   * @returns Map of key to value (null for missing keys)
   */
  getBatch?(keys: string[]): Promise<Map<string, string | null>>;

  /**
   * Set a value in the cache.
   * @param key - Cache key
   * @param value - Value to store
   * @param ttlSeconds - Time to live in seconds
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Set multiple values in the cache in a single batch.
   * @param entries - Array of {key, value, ttl} objects
   */
  setBatch?(entries: CacheSetBatchEntry[]): Promise<void>;

  /**
   * Delete a value from the cache.
   * @param key - Cache key
   */
  del(key: string): Promise<void>;

  /**
   * Delete all values matching a pattern.
   * @param pattern - Glob pattern (e.g., "user:*")
   * @returns Number of deleted keys
   */
  delByPattern?(pattern: string): Promise<number>;

  /** Current number of entries (for memory backend) */
  readonly size?: number;
}
