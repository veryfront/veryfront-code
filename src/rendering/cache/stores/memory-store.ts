import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { CachePayload, CacheStore } from "../types.ts";

/**
 * Default max entries for render cache.
 * Kept small (100) to conserve memory in ephemeral pods.
 * Most traffic should hit Redis; memory cache is for hot pages only.
 */
const DEFAULT_MAX_ENTRIES = 100;

export interface MemoryCacheStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
}

export class MemoryCacheStore implements CacheStore {
  private cache: LRUCache<string, CachePayload>;

  constructor(options: MemoryCacheStoreOptions = {}) {
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

  /**
   * Delete all entries with keys starting with the given prefix.
   * Used for per-project cache invalidation in multi-tenant deployments.
   */
  deleteByPrefix(prefix: string): Promise<number> {
    let deleted = 0;

    for (const key of this.cache.keys()) {
      if (!key.startsWith(prefix)) continue;
      this.cache.delete(key);
      deleted++;
    }

    return Promise.resolve(deleted);
  }

  clear(): Promise<void> {
    this.cache.clear();
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    this.cache.destroy();
    return Promise.resolve();
  }
}

function isLruIntervalDisabled(): boolean {
  const globalFlag = (globalThis as Record<string, unknown>).__vfDisableLruInterval === true;
  return globalFlag || getDisableLruIntervalEnv();
}
