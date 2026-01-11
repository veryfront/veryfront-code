import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import type { CachePayload, CacheStore } from "../types.ts";
import { getDisableLruIntervalEnv } from "@veryfront/core/config/env.ts";

export interface MemoryCacheStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
}

export class MemoryCacheStore implements CacheStore {
  private cache: LRUCache<string, CachePayload>;

  constructor(options: MemoryCacheStoreOptions = {}) {
    const disableIntervals = isLruIntervalDisabled();
    this.cache = new LRUCache<string, CachePayload>({
      maxEntries: options.maxEntries ?? 500,
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
  return (globalThis as Record<string, unknown>).__vfDisableLruInterval === true ||
    getDisableLruIntervalEnv();
}
