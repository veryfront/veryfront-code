import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  DATA_FETCHING_MAX_ENTRIES,
  DATA_FETCHING_TTL_MS,
} from "#veryfront/utils/constants/cache.ts";
import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { getProjectScopedKey } from "#veryfront/cache/cache-key-builder.ts";
import type { CacheEntry, DataContext } from "./types.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";

function snapshotCacheEntry(entry: CacheEntry): CacheEntry {
  try {
    return structuredClone(entry);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Static data results must be structured-cloneable before caching",
    });
  }
}

function canonicalizeParams(
  params: DataContext["params"],
): Array<[string, string | string[]]> {
  return Object.keys(params).sort().map((key) => [key, params[key] as string | string[]]);
}

function isLruIntervalDisabled(): boolean {
  const globalFlag = (globalThis as Record<string, unknown>).__vfDisableLruInterval;
  return globalFlag === true || getDisableLruIntervalEnv();
}

export class CacheManager {
  private cache = new LRUCache<string, CacheEntry>({
    maxEntries: DATA_FETCHING_MAX_ENTRIES,
    ttlMs: isLruIntervalDisabled() ? undefined : DATA_FETCHING_TTL_MS,
  });

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    return entry === undefined ? null : snapshotCacheEntry(entry);
  }

  set(key: string, entry: CacheEntry): void {
    this.cache.set(key, snapshotCacheEntry(entry));
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  destroy(): void {
    this.cache.destroy();
  }

  clearPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (!key.includes(pattern)) continue;
      this.cache.delete(key);
    }
  }

  shouldRevalidate(entry: CacheEntry): boolean {
    if (entry.revalidate === false) return false;
    if (typeof entry.revalidate !== "number") return false;

    return Date.now() - entry.timestamp > entry.revalidate * 1000;
  }

  createCacheKey(context: DataContext, dataSource = "default"): string | null {
    const resourceKey = JSON.stringify([
      dataSource,
      context.url.origin,
      context.url.pathname,
      canonicalizeParams(context.params),
    ]);
    return getProjectScopedKey("veryfront:data", resourceKey);
  }
}
