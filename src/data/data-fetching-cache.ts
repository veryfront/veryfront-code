import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  DATA_FETCHING_MAX_ENTRIES,
  DATA_FETCHING_TTL_MS,
} from "#veryfront/utils/constants/cache.ts";
import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { getProjectScopedKey } from "#veryfront/cache/cache-key-builder.ts";
import type { CacheEntry, DataContext } from "./types.ts";

function isLruIntervalDisabled(): boolean {
  return (globalThis as Record<string, unknown>).__vfDisableLruInterval === true ||
    getDisableLruIntervalEnv();
}

export class CacheManager {
  private cache = new LRUCache<string, CacheEntry>({
    maxEntries: DATA_FETCHING_MAX_ENTRIES,
    ttlMs: isLruIntervalDisabled() ? undefined : DATA_FETCHING_TTL_MS,
  });

  get(key: string): CacheEntry | null {
    return this.cache.get(key) ?? null;
  }

  set(key: string, entry: CacheEntry): void {
    this.cache.set(key, entry);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  clearPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  shouldRevalidate(entry: CacheEntry): boolean {
    if (entry.revalidate === false) return false;

    if (typeof entry.revalidate !== "number") return false;

    const age = Date.now() - entry.timestamp;
    return age > entry.revalidate * 1000;
  }

  createCacheKey(context: DataContext): string | null {
    const params = JSON.stringify(context.params);
    const resourceKey = `${context.url.pathname}::${params}`;
    return getProjectScopedKey("veryfront:data", resourceKey);
  }
}
