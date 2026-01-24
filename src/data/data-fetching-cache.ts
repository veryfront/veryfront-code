import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  DATA_FETCHING_MAX_ENTRIES,
  DATA_FETCHING_TTL_MS,
} from "#veryfront/utils/constants/cache.ts";
import type { CacheEntry, DataContext } from "./types.ts";
import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { getProjectScopedKey } from "#veryfront/cache/cache-key-builder.ts";

function isLruIntervalDisabled(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) {
    return true;
  }
  return getDisableLruIntervalEnv();
}

export class CacheManager {
  private cache = new LRUCache<string, CacheEntry>({
    maxEntries: DATA_FETCHING_MAX_ENTRIES,
    ttlMs: isLruIntervalDisabled() ? undefined : DATA_FETCHING_TTL_MS,
  });

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    return entry ?? null;
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
    // Use LRU cache's keys() directly - no separate tracking needed
    // This stays in sync with LRU evictions automatically
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  shouldRevalidate(entry: CacheEntry): boolean {
    if (entry.revalidate === false) {
      return false;
    }

    if (typeof entry.revalidate === "number") {
      const age = Date.now() - entry.timestamp;
      return age > entry.revalidate * 1000;
    }

    return false;
  }

  /**
   * Create a project-scoped cache key for data fetching.
   *
   * Returns null in preview mode (no caching without content hash).
   * In production mode, returns a key scoped by project and release.
   */
  createCacheKey(context: DataContext): string | null {
    const params = JSON.stringify(context.params);
    const pathname = context.url.pathname;
    const resourceKey = `${pathname}::${params}`;

    // Use project-scoped key (returns null in preview mode)
    return getProjectScopedKey("veryfront:data", resourceKey);
  }
}
