import { MEMORY_CACHE_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import type { CacheBackend } from "../types.ts";

export class MemoryCacheBackend implements CacheBackend {
  readonly type = "memory" as const;
  private store = new Map<string, { value: string; expiresAt: number }>();
  private regexCache = new Map<string, RegExp>();
  private maxEntries: number;

  constructor(maxEntries = MEMORY_CACHE_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return Promise.resolve(null);
    }

    return Promise.resolve(entry.value);
  }

  getBatch(keys: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    const now = Date.now();

    for (const key of keys) {
      const entry = this.store.get(key);
      if (!entry) {
        results.set(key, null);
        continue;
      }

      if (now > entry.expiresAt) {
        this.store.delete(key);
        results.set(key, null);
        continue;
      }

      results.set(key, entry.value);
    }

    return Promise.resolve(results);
  }

  set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (oldest) this.store.delete(oldest);
    }

    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    const now = Date.now();

    for (const { key, value, ttl } of entries) {
      if (this.store.size >= this.maxEntries && !this.store.has(key)) {
        const oldest = this.store.keys().next().value as string | undefined;
        if (oldest) this.store.delete(oldest);
      }

      this.store.set(key, {
        value,
        expiresAt: now + (ttl ?? 300) * 1000,
      });
    }

    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  delByPattern(pattern: string): Promise<number> {
    let regex = this.regexCache.get(pattern);
    if (!regex) {
      regex = new RegExp(`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

      if (this.regexCache.size >= 100) {
        const firstKey = this.regexCache.keys().next().value as string | undefined;
        if (firstKey) this.regexCache.delete(firstKey);
      }

      this.regexCache.set(pattern, regex);
    }

    let deleted = 0;
    for (const key of this.store.keys()) {
      if (!regex.test(key)) continue;
      this.store.delete(key);
      deleted++;
    }

    return Promise.resolve(deleted);
  }

  clear(): void {
    this.store.clear();
    this.regexCache.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
