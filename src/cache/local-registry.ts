/**
 * Dependency-light registry for in-process cache stores.
 *
 * This module owns only local cache inspection and invalidation. Distributed
 * cache administration is layered on top by `registry.ts`, which lets small
 * public contracts register local caches without importing infrastructure.
 *
 * @module cache/local-registry
 */

import { rendererLogger } from "#veryfront/utils/logger/index.ts";

const logger = rendererLogger.component("cache-registry");

const MAX_REGISTERED_CACHE_STORES = 1_000;
const MAX_CACHE_STORE_NAME_CODE_UNITS = 256;

export interface CacheStore {
  readonly name: string;
  readonly projectOwnership?: CacheStoreProjectOwnership;
  get(key: string): unknown;
  keys(): Iterable<string>;
  size(): number;
  deleteWhere?(predicate: (key: string) => boolean): number;
}

/**
 * Project invalidation is opt-in for local stores. A registry entry without an
 * ownership descriptor remains observable for diagnostics, but opaque keys are
 * never reinterpreted and deleted merely because one segment resembles a
 * project identifier.
 */
export interface CacheStoreProjectOwnership {
  isKeyForProject(key: string, projectId: string): boolean;
  isKeyForProjectEnvironment(
    key: string,
    projectId: string,
    environment: "production" | "preview",
  ): boolean;
  isKeyForContentSource(key: string, projectId: string, contentSourceId: string): boolean;
}

function deleteWhereFromKeys(
  keys: Iterable<string>,
  deleteKey: (key: string) => boolean,
  predicate: (key: string) => boolean,
): number {
  let deleted = 0;
  for (const key of keys) {
    if (!predicate(key)) continue;
    deleteKey(key);
    deleted++;
  }
  return deleted;
}

export class MapCacheStore implements CacheStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly map: CacheStatsSource,
    readonly projectOwnership?: CacheStoreProjectOwnership,
  ) {
    this.name = name;
  }

  get(key: string): unknown {
    return this.map.get(key);
  }

  keys(): Iterable<string> {
    return this.map.keys();
  }

  size(): number {
    return this.map.size;
  }

  deleteWhere(predicate: (key: string) => boolean): number {
    return deleteWhereFromKeys(this.map.keys(), (key) => this.map.delete(key), predicate);
  }
}

interface LRULike {
  get(key: string): unknown;
  keys(): Iterable<string>;
  size: number;
  delete(key: string): boolean;
}

/**
 * Narrow view of a key/value store sufficient for cache stats + inspection.
 * Both native `Map` and the LRU cache wrapper structurally satisfy this, so
 * callers can register lightweight wrappers without unsound `Map` casts.
 */
export interface CacheStatsSource {
  get(key: string): unknown;
  keys(): Iterable<string>;
  readonly size: number;
  delete(key: string): boolean;
}

export class LRUCacheStore implements CacheStore {
  readonly name: string;

  constructor(
    name: string,
    private readonly cache: LRULike,
    readonly projectOwnership?: CacheStoreProjectOwnership,
  ) {
    this.name = name;
  }

  get(key: string): unknown {
    return this.cache.get(key);
  }

  keys(): Iterable<string> {
    return this.cache.keys();
  }

  size(): number {
    return this.cache.size;
  }

  deleteWhere(predicate: (key: string) => boolean): number {
    return deleteWhereFromKeys(this.cache.keys(), (key) => this.cache.delete(key), predicate);
  }
}

/** Shared mutable state used by the local and distributed registry facades. */
export class LocalCacheRegistryState {
  readonly stores = new Map<string, CacheStore>();
}

/** Registry operations that require no distributed-cache implementation. */
export class LocalCacheRegistry {
  constructor(private readonly state = new LocalCacheRegistryState()) {}

  register(store: CacheStore): () => boolean {
    const name = store.name;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > MAX_CACHE_STORE_NAME_CODE_UNITS ||
      name.trim() !== name ||
      /\p{Cc}/u.test(name)
    ) {
      throw new TypeError(
        "Cache store name must be a trimmed 1-256 character string without control characters",
      );
    }
    if (!this.state.stores.has(name) && this.state.stores.size >= MAX_REGISTERED_CACHE_STORES) {
      throw new RangeError(
        `Cache registry may retain at most ${MAX_REGISTERED_CACHE_STORES} stores`,
      );
    }
    if (this.state.stores.has(name)) {
      logger.warn(`Replacing existing store: ${name}`);
    }
    this.state.stores.set(name, store);
    logger.debug(`Registered store: ${name}`);

    return () => {
      if (this.state.stores.get(name) !== store) return false;
      return this.state.stores.delete(name);
    };
  }

  unregister(name: string): boolean {
    return this.state.stores.delete(name);
  }

  get(name: string): CacheStore | undefined {
    return this.state.stores.get(name);
  }

  getStoreNames(): string[] {
    return [...this.state.stores.keys()];
  }

  getAllKeys(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [name, store] of this.state.stores) {
      result.set(name, [...store.keys()]);
    }
    return result;
  }

  getKeysForProject(projectId: string): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const [name, store] of this.state.stores) {
      const matchingKeys = [...store.keys()].filter((key) =>
        store.projectOwnership?.isKeyForProject(key, projectId) ?? false
      );
      if (matchingKeys.length) result.set(name, matchingKeys);
    }

    return result;
  }

  countKeysForProject(projectId: string): number {
    let count = 0;
    for (const store of this.state.stores.values()) {
      for (const key of store.keys()) {
        if (store.projectOwnership?.isKeyForProject(key, projectId)) count++;
      }
    }
    return count;
  }

  deleteKeysForProject(projectId: string): number {
    let totalDeleted = 0;

    for (const store of this.state.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        store.projectOwnership?.isKeyForProject(key, projectId) ?? false
      ) ?? 0;
    }

    return totalDeleted;
  }

  /** Delete cache entries for a specific project and environment. */
  deleteKeysForProjectEnvironment(
    projectId: string,
    environment: "production" | "preview",
  ): number {
    let totalDeleted = 0;

    for (const store of this.state.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        store.projectOwnership?.isKeyForProjectEnvironment(key, projectId, environment) ?? false
      ) ?? 0;
    }

    logger.debug("Deleted keys for project environment", {
      projectId,
      environment,
      deleted: totalDeleted,
    });

    return totalDeleted;
  }

  /** Delete cache entries for a specific content source (branch or release). */
  deleteKeysForContentSource(projectId: string, contentSourceId: string): number {
    let totalDeleted = 0;

    for (const store of this.state.stores.values()) {
      totalDeleted += store.deleteWhere?.((key) =>
        store.projectOwnership?.isKeyForContentSource(key, projectId, contentSourceId) ?? false
      ) ?? 0;
    }

    logger.debug("Deleted keys for content source", {
      projectId,
      contentSourceId,
      deleted: totalDeleted,
    });

    return totalDeleted;
  }

  getStats(): Array<{ name: string; size: number; sampleKeys: string[] }> {
    const stats: Array<{ name: string; size: number; sampleKeys: string[] }> = [];

    for (const [name, store] of this.state.stores) {
      const sampleKeys: string[] = [];
      for (const key of store.keys()) {
        sampleKeys.push(key);
        if (sampleKeys.length === 5) break;
      }
      stats.push({ name, size: store.size(), sampleKeys });
    }

    return stats;
  }

  clear(): void {
    this.state.stores.clear();
  }
}

const sharedLocalCacheRegistryState = new LocalCacheRegistryState();
const sharedLocalCacheRegistry = new LocalCacheRegistry(sharedLocalCacheRegistryState);

/** Internal state shared with the full distributed-administration facade. */
export function getSharedLocalCacheRegistryState(): LocalCacheRegistryState {
  return sharedLocalCacheRegistryState;
}

export function registerMapCache(
  name: string,
  map: CacheStatsSource,
  projectOwnership?: CacheStoreProjectOwnership,
): () => boolean {
  return sharedLocalCacheRegistry.register(new MapCacheStore(name, map, projectOwnership));
}

export function registerLRUCache(
  name: string,
  cache: LRULike,
  projectOwnership?: CacheStoreProjectOwnership,
): () => boolean {
  return sharedLocalCacheRegistry.register(new LRUCacheStore(name, cache, projectOwnership));
}
