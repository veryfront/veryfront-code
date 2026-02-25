import {
  MEMORY_CACHE_MAX_ENTRIES,
  MEMORY_CACHE_MAX_SIZE_BYTES,
} from "#veryfront/utils/constants/cache.ts";
import type { CacheBackend } from "../types.ts";

export class MemoryCacheBackend implements CacheBackend {
  readonly type = "memory" as const;
  private store = new Map<string, { value: string; expiresAt: number; sizeBytes: number }>();
  private regexCache = new Map<string, RegExp>();
  private maxEntries: number;
  private readonly maxSizeBytes: number;
  private currentSizeBytes = 0;

  constructor(maxEntries = MEMORY_CACHE_MAX_ENTRIES, options?: { maxSizeBytes?: number }) {
    this.maxEntries = maxEntries;
    this.maxSizeBytes = options?.maxSizeBytes ?? MEMORY_CACHE_MAX_SIZE_BYTES;
  }

  private estimateSize(key: string, value: string): number {
    return key.length + value.length;
  }

  private evictOldest(): void {
    const oldest = this.store.keys().next().value as string | undefined;
    if (!oldest) return;
    const entry = this.store.get(oldest);
    if (entry) this.currentSizeBytes -= entry.sizeBytes;
    this.store.delete(oldest);
  }

  get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);

    if (Date.now() > entry.expiresAt) {
      this.currentSizeBytes -= entry.sizeBytes;
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
        this.currentSizeBytes -= entry.sizeBytes;
        this.store.delete(key);
        results.set(key, null);
        continue;
      }

      results.set(key, entry.value);
    }

    return Promise.resolve(results);
  }

  set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    const entrySize = this.estimateSize(key, value);

    // Reject single entries that exceed the byte limit on their own
    if (entrySize > this.maxSizeBytes) return Promise.resolve();

    // Remove existing entry for clean size tracking
    const existing = this.store.get(key);
    if (existing) {
      this.currentSizeBytes -= existing.sizeBytes;
      this.store.delete(key);
    }

    // Evict oldest entries while over count or size limits
    while (
      this.store.size > 0 && (
        this.store.size >= this.maxEntries ||
        this.currentSizeBytes + entrySize > this.maxSizeBytes
      )
    ) {
      this.evictOldest();
    }

    this.currentSizeBytes += entrySize;
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, sizeBytes: entrySize });
    return Promise.resolve();
  }

  setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    const now = Date.now();

    for (const { key, value, ttl } of entries) {
      const entrySize = this.estimateSize(key, value);

      if (entrySize > this.maxSizeBytes) continue;

      const existing = this.store.get(key);
      if (existing) {
        this.currentSizeBytes -= existing.sizeBytes;
        this.store.delete(key);
      }

      while (
        this.store.size > 0 && (
          this.store.size >= this.maxEntries ||
          this.currentSizeBytes + entrySize > this.maxSizeBytes
        )
      ) {
        this.evictOldest();
      }

      this.currentSizeBytes += entrySize;
      this.store.set(key, {
        value,
        expiresAt: now + (ttl ?? 300) * 1000,
        sizeBytes: entrySize,
      });
    }

    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry) this.currentSizeBytes -= entry.sizeBytes;
    this.store.delete(key);
    return Promise.resolve();
  }

  delByPattern(pattern: string): Promise<number> {
    let regex = this.regexCache.get(pattern);
    if (!regex) {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

      if (this.regexCache.size >= 100) {
        const firstKey = this.regexCache.keys().next().value as string | undefined;
        if (firstKey) this.regexCache.delete(firstKey);
      }

      this.regexCache.set(pattern, regex);
    }

    let deleted = 0;
    for (const key of this.store.keys()) {
      if (!regex.test(key)) continue;
      const entry = this.store.get(key);
      if (entry) this.currentSizeBytes -= entry.sizeBytes;
      this.store.delete(key);
      deleted++;
    }

    return Promise.resolve(deleted);
  }

  clear(): void {
    this.store.clear();
    this.regexCache.clear();
    this.currentSizeBytes = 0;
  }

  get size(): number {
    return this.store.size;
  }

  get sizeBytes(): number {
    return this.currentSizeBytes;
  }
}
