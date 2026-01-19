/**
 * Cache Registry
 *
 * Central registry for all cache stores in the system.
 * Enables querying cache keys across all stores for a specific project.
 *
 * Supports:
 * - In-memory caches (Map, LRU)
 * - Redis caches (via SCAN)
 *
 * @module core/cache/registry
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { getRedisClient, isRedisConfigured } from "#veryfront/utils/redis-client.ts";

/**
 * Interface for cache stores that can be registered.
 * Stores must provide a way to iterate over their keys.
 */
export interface CacheStore {
  /** Unique name for this cache store */
  readonly name: string;

  /** Get all keys in this cache store */
  keys(): Iterable<string>;

  /** Get the number of entries in this cache store */
  size(): number;

  /** Optional: Delete keys matching a predicate */
  deleteWhere?(predicate: (key: string) => boolean): number;
}

/**
 * Adapter to wrap a Map as a CacheStore.
 */
export class MapCacheStore implements CacheStore {
  constructor(
    public readonly name: string,
    private readonly map: Map<string, unknown>,
  ) {}

  keys(): Iterable<string> {
    return this.map.keys();
  }

  size(): number {
    return this.map.size;
  }

  deleteWhere(predicate: (key: string) => boolean): number {
    let deleted = 0;
    for (const key of [...this.map.keys()]) {
      if (predicate(key)) {
        this.map.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}

/**
 * Interface for LRU-like caches that have keys() and delete() methods.
 */
interface LRULike {
  keys(): Iterable<string>;
  size: number;
  delete(key: string): boolean;
}

/**
 * Adapter to wrap an LRU cache as a CacheStore.
 */
export class LRUCacheStore implements CacheStore {
  constructor(
    public readonly name: string,
    private readonly cache: LRULike,
  ) {}

  keys(): Iterable<string> {
    return this.cache.keys();
  }

  size(): number {
    return this.cache.size;
  }

  deleteWhere(predicate: (key: string) => boolean): number {
    let deleted = 0;
    for (const key of [...this.cache.keys()]) {
      if (predicate(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}

/**
 * Global cache registry instance.
 */
class CacheRegistry {
  private stores = new Map<string, CacheStore>();

  /**
   * Register a cache store with the registry.
   */
  register(store: CacheStore): void {
    if (this.stores.has(store.name)) {
      logger.warn(`[CacheRegistry] Replacing existing store: ${store.name}`);
    }
    this.stores.set(store.name, store);
    logger.debug(`[CacheRegistry] Registered store: ${store.name}`);
  }

  /**
   * Unregister a cache store.
   */
  unregister(name: string): boolean {
    return this.stores.delete(name);
  }

  /**
   * Get a registered cache store by name.
   */
  get(name: string): CacheStore | undefined {
    return this.stores.get(name);
  }

  /**
   * Get all registered store names.
   */
  getStoreNames(): string[] {
    return [...this.stores.keys()];
  }

  /**
   * Get all keys across all registered stores.
   */
  getAllKeys(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [name, store] of this.stores) {
      result.set(name, [...store.keys()]);
    }
    return result;
  }

  /**
   * Get all keys for a specific project across all stores.
   *
   * @param projectId - The project ID to filter by
   * @returns Map of store name to matching keys
   */
  getKeysForProject(projectId: string): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const [name, store] of this.stores) {
      const matchingKeys: string[] = [];
      for (const key of store.keys()) {
        if (isKeyForProject(key, projectId)) {
          matchingKeys.push(key);
        }
      }
      if (matchingKeys.length > 0) {
        result.set(name, matchingKeys);
      }
    }

    return result;
  }

  /**
   * Count all keys for a specific project across all stores.
   */
  countKeysForProject(projectId: string): number {
    let count = 0;
    for (const store of this.stores.values()) {
      for (const key of store.keys()) {
        if (isKeyForProject(key, projectId)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Delete all keys for a specific project across all stores.
   *
   * @param projectId - The project ID to delete keys for
   * @returns Total number of keys deleted
   */
  deleteKeysForProject(projectId: string): number {
    let totalDeleted = 0;

    for (const store of this.stores.values()) {
      if (store.deleteWhere) {
        totalDeleted += store.deleteWhere((key) => isKeyForProject(key, projectId));
      }
    }

    return totalDeleted;
  }

  /**
   * Get statistics about all registered stores.
   */
  getStats(): Array<{ name: string; size: number; sampleKeys: string[] }> {
    const stats: Array<{ name: string; size: number; sampleKeys: string[] }> = [];

    for (const [name, store] of this.stores) {
      const keys = [...store.keys()];
      stats.push({
        name,
        size: store.size(),
        sampleKeys: keys.slice(0, 5), // First 5 keys as sample
      });
    }

    return stats;
  }

  /**
   * Clear the registry (for testing).
   */
  clear(): void {
    this.stores.clear();
  }

  // =========================================================================
  // Redis Operations (for ephemeral pods)
  // =========================================================================

  /**
   * Scan Redis for keys matching a pattern.
   * Use this for ephemeral pods where in-memory caches are not reliable.
   *
   * @param pattern - Redis SCAN pattern (e.g., "veryfront:ssr-module:*")
   * @param limit - Maximum number of keys to return (default 1000)
   */
  async scanRedisKeys(pattern: string, limit = 1000): Promise<string[]> {
    if (!isRedisConfigured()) {
      return [];
    }

    try {
      const client = await getRedisClient();
      const keys: string[] = [];
      let cursor = 0;

      do {
        const result = await client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100,
        });
        cursor = typeof result.cursor === "string" ? parseInt(result.cursor, 10) : result.cursor;
        keys.push(...result.keys);

        if (keys.length >= limit) {
          break;
        }
      } while (cursor !== 0);

      return keys.slice(0, limit);
    } catch (error) {
      logger.warn("[CacheRegistry] Redis scan failed", { pattern, error });
      return [];
    }
  }

  /**
   * Get all Redis keys for a specific project.
   *
   * Scans common Redis prefixes:
   * - veryfront:ssr-module:*
   * - veryfront:file-cache:*
   * - veryfront:transform:*
   *
   * @param projectId - The project ID to filter by
   * @returns Map of Redis prefix to matching keys
   */
  async getRedisKeysForProject(projectId: string): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();

    const prefixes = [
      "veryfront:ssr-module:",
      "veryfront:file-cache:",
      "veryfront:transform:",
    ];

    for (const prefix of prefixes) {
      const keys = await this.scanRedisKeys(`${prefix}*`);
      const matchingKeys = keys.filter((key) => isKeyForProject(key, projectId));
      if (matchingKeys.length > 0) {
        result.set(prefix.replace(/:$/, ""), matchingKeys);
      }
    }

    return result;
  }

  /**
   * Get all keys for a project from both memory and Redis.
   *
   * @param projectId - The project ID to filter by
   * @param includeRedis - Whether to scan Redis (default false for performance)
   */
  async getAllKeysForProjectAsync(
    projectId: string,
    includeRedis = false,
  ): Promise<{ memory: Map<string, string[]>; redis: Map<string, string[]> }> {
    const memory = this.getKeysForProject(projectId);

    if (!includeRedis) {
      return { memory, redis: new Map() };
    }

    const redis = await this.getRedisKeysForProject(projectId);
    return { memory, redis };
  }

  /**
   * Delete Redis keys for a specific project.
   *
   * @param projectId - The project ID to delete keys for
   * @returns Number of keys deleted
   */
  async deleteRedisKeysForProject(projectId: string): Promise<number> {
    if (!isRedisConfigured()) {
      return 0;
    }

    try {
      const client = await getRedisClient();
      const redisKeys = await this.getRedisKeysForProject(projectId);

      let deleted = 0;
      for (const keys of redisKeys.values()) {
        if (keys.length > 0) {
          deleted += await client.del(keys);
        }
      }

      return deleted;
    } catch (error) {
      logger.warn("[CacheRegistry] Redis delete failed", { projectId, error });
      return 0;
    }
  }

  /**
   * Delete all keys for a project from both memory and Redis.
   */
  async deleteAllKeysForProjectAsync(projectId: string): Promise<{
    memoryDeleted: number;
    redisDeleted: number;
  }> {
    const memoryDeleted = this.deleteKeysForProject(projectId);
    const redisDeleted = await this.deleteRedisKeysForProject(projectId);

    return { memoryDeleted, redisDeleted };
  }
}

/**
 * Check if a cache key belongs to a specific project.
 *
 * Cache key format: {prefix}:{projectId}:{...rest}
 * The projectId should be at position 1 (after the prefix).
 *
 * Also checks other positions for backward compatibility with keys
 * that may have projectId in different positions.
 */
export function isKeyForProject(key: string, projectId: string): boolean {
  const parts = key.split(":");
  if (parts.length < 2) return false;

  // Primary check: projectId at position 1 (standard format)
  if (parts[1] === projectId) return true;

  // Secondary check: projectId at position 2 (for keys like file:env:projectSlug:...)
  if (parts.length > 2 && parts[2] === projectId) return true;

  // Fallback: check if projectId appears anywhere (legacy support)
  // This is less precise but ensures we don't miss any keys
  return parts.includes(projectId);
}

/**
 * Extract the project ID from a cache key.
 *
 * @param key - The cache key
 * @returns The project ID if found, or null
 */
export function extractProjectIdFromKey(key: string): string | null {
  const parts = key.split(":");
  if (parts.length < 2) return null;

  // Standard format: {prefix}:{projectId}:{...rest}
  // Return position 1 as the most likely projectId
  return parts[1] ?? null;
}

// Singleton instance
export const cacheRegistry = new CacheRegistry();

// Convenience function for registering a Map as a cache store
export function registerMapCache(name: string, map: Map<string, unknown>): void {
  cacheRegistry.register(new MapCacheStore(name, map));
}

// Convenience function for registering an LRU cache as a cache store
export function registerLRUCache(name: string, cache: LRULike): void {
  cacheRegistry.register(new LRUCacheStore(name, cache));
}
