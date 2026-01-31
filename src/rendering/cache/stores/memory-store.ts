/**
 * Memory Cache Store
 *
 * LRU-based in-memory cache store for render results.
 * Supports optional cache injection for testing.
 *
 * @module rendering/cache/stores/memory-store
 */

import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { CachePayload, CacheStore } from "../types.ts";

const DEFAULT_MAX_ENTRIES = 100;

export interface CacheLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
  keys(): IterableIterator<K>;
  clear(): void;
  destroy?(): void;
}

export interface MemoryCacheStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
  /** Optional cache implementation for testing */
  cache?: CacheLike<string, CachePayload>;
}

export class MemoryCacheStore implements CacheStore {
  private cache: CacheLike<string, CachePayload>;

  constructor(options: MemoryCacheStoreOptions = {}) {
    if (options.cache) {
      this.cache = options.cache;
      return;
    }

    const disableIntervals = isLruIntervalDisabled();
    this.cache = new LRUCache<string, CachePayload>({
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      ttlMs: disableIntervals ? undefined : options.ttlMs,
    });
  }

  get(key: string): Promise<CachePayload | undefined> {
    return Promise.resolve(this.cache.get(key));
  }

  set(key: string, value: CachePayload): Promise<void> {
    this.cache.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.cache.delete(key);
    return Promise.resolve();
  }

  deleteByPrefix(prefix: string): Promise<number> {
    let deleted = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deleted++;
      }
    }

    return Promise.resolve(deleted);
  }

  clear(): Promise<void> {
    this.cache.clear();
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    this.cache.destroy?.();
    return Promise.resolve();
  }
}

function isLruIntervalDisabled(): boolean {
  const globalFlag = (globalThis as Record<string, unknown>).__vfDisableLruInterval === true;
  return globalFlag || getDisableLruIntervalEnv();
}
