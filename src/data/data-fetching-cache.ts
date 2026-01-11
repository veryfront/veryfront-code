import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import {
  DATA_FETCHING_MAX_ENTRIES,
  DATA_FETCHING_TTL_MS,
} from "@veryfront/utils/constants/cache.ts";
import type { CacheEntry, DataContext } from "./types.ts";
import { getEnv } from "@veryfront/platform/compat/process.ts";

function isLruIntervalDisabled(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) {
    return true;
  }
  try {
    return getEnv("VF_DISABLE_LRU_INTERVAL") === "1";
  } catch {
    return false;
  }
}

export class CacheManager {
  private cache = new LRUCache<string, CacheEntry>({
    maxEntries: DATA_FETCHING_MAX_ENTRIES,
    ttlMs: isLruIntervalDisabled() ? undefined : DATA_FETCHING_TTL_MS,
  });
  private cacheKeys = new Set<string>();

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    return entry ?? null;
  }

  set(key: string, entry: CacheEntry): void {
    this.cache.set(key, entry);
    this.cacheKeys.add(key);
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.cacheKeys.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.cacheKeys.clear();
  }

  clearPattern(pattern: string): void {
    for (const key of this.cacheKeys) {
      if (key.includes(pattern)) {
        this.delete(key);
      }
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

  createCacheKey(context: DataContext): string {
    const params = JSON.stringify(context.params);
    const pathname = context.url.pathname;
    return `${pathname}::${params}`;
  }
}
