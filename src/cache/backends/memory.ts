import {
  MEMORY_CACHE_MAX_ENTRIES,
  MEMORY_CACHE_MAX_SIZE_BYTES,
} from "#veryfront/utils/constants/cache.ts";
import type { CacheBackend } from "../types.ts";
import { buildBatchResults } from "../batch-results.ts";
import { type CacheGlob, compileCacheGlob } from "./glob.ts";
import { DEFAULT_CACHE_TTL_SECONDS, expiresImmediately, resolveCacheTtlSeconds } from "./ttl.ts";

const MAX_GLOB_CACHE_SIZE = 100;
const sizeEncoder = new TextEncoder();

export class MemoryCacheBackend implements CacheBackend {
  readonly type = "memory" as const;
  private store = new Map<string, { value: string; expiresAt: number; sizeBytes: number }>();
  private globCache = new Map<string, CacheGlob>();
  private maxEntries: number;
  private readonly maxSizeBytes: number;
  private currentSizeBytes = 0;

  constructor(maxEntries = MEMORY_CACHE_MAX_ENTRIES, options?: { maxSizeBytes?: number }) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError("Memory cache maxEntries must be a non-negative safe integer");
    }
    const maxSizeBytes = options?.maxSizeBytes ?? MEMORY_CACHE_MAX_SIZE_BYTES;
    if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes < 0) {
      throw new RangeError("Memory cache maxSizeBytes must be a non-negative safe integer");
    }
    this.maxEntries = maxEntries;
    this.maxSizeBytes = maxSizeBytes;
  }

  private estimateSize(key: string, value: string): number {
    return sizeEncoder.encode(key).byteLength + sizeEncoder.encode(value).byteLength;
  }

  private deleteStoredEntry(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    this.currentSizeBytes -= entry.sizeBytes;
    return this.store.delete(key);
  }

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) this.deleteStoredEntry(key);
    }
  }

  private evictOldest(): void {
    const oldest = this.store.keys().next();
    if (oldest.done) return;
    this.deleteStoredEntry(oldest.value);
  }

  get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);

    if (Date.now() >= entry.expiresAt) {
      this.deleteStoredEntry(key);
      return Promise.resolve(null);
    }

    return Promise.resolve(entry.value);
  }

  getRemainingTtlSeconds(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);

    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.deleteStoredEntry(key);
      return Promise.resolve(null);
    }

    return Promise.resolve(remainingMs / 1000);
  }

  getBatch(keys: string[]): Promise<Map<string, string | null>> {
    const now = Date.now();

    const results = buildBatchResults(keys, (key) => {
      const entry = this.store.get(key);
      if (!entry) return null;

      if (now >= entry.expiresAt) {
        this.deleteStoredEntry(key);
        return null;
      }

      return entry.value;
    });

    return Promise.resolve(results);
  }

  async set(key: string, value: string, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS): Promise<void> {
    const ttl = resolveCacheTtlSeconds(ttlSeconds, DEFAULT_CACHE_TTL_SECONDS)!;
    if (expiresImmediately(ttl)) {
      this.deleteStoredEntry(key);
      return;
    }
    const entrySize = this.estimateSize(key, value);
    this.deleteStoredEntry(key);

    if (this.maxEntries <= 0 || this.maxSizeBytes <= 0) return;

    // Reject single entries that exceed the byte limit on their own
    if (entrySize > this.maxSizeBytes) return;

    if (
      this.store.size >= this.maxEntries ||
      this.currentSizeBytes + entrySize > this.maxSizeBytes
    ) {
      this.purgeExpired(Date.now());
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
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000, sizeBytes: entrySize });
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    const resolvedEntries = entries.map(({ key, value, ttl }) => ({
      key,
      value,
      ttl: resolveCacheTtlSeconds(ttl, DEFAULT_CACHE_TTL_SECONDS)!,
    }));

    const now = Date.now();

    for (const { key, value, ttl } of resolvedEntries) {
      if (expiresImmediately(ttl)) {
        this.deleteStoredEntry(key);
        continue;
      }
      const entrySize = this.estimateSize(key, value);
      this.deleteStoredEntry(key);

      if (this.maxEntries <= 0 || this.maxSizeBytes <= 0) continue;

      if (entrySize > this.maxSizeBytes) continue;

      if (
        this.store.size >= this.maxEntries ||
        this.currentSizeBytes + entrySize > this.maxSizeBytes
      ) {
        this.purgeExpired(now);
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
        expiresAt: now + ttl * 1000,
        sizeBytes: entrySize,
      });
    }
  }

  del(key: string): Promise<void> {
    this.deleteStoredEntry(key);
    return Promise.resolve();
  }

  delByPattern(pattern: string): Promise<number> {
    let glob = this.globCache.get(pattern);
    if (!glob) {
      glob = compileCacheGlob(pattern) ?? undefined;
      if (!glob) return Promise.resolve(0);

      if (this.globCache.size >= MAX_GLOB_CACHE_SIZE) {
        const firstKey = this.globCache.keys().next();
        if (!firstKey.done) this.globCache.delete(firstKey.value);
      }

      this.globCache.set(pattern, glob);
    }

    let deleted = 0;
    for (const key of this.store.keys()) {
      if (!glob.test(key)) continue;
      this.deleteStoredEntry(key);
      deleted++;
    }

    return Promise.resolve(deleted);
  }

  clear(): void {
    this.store.clear();
    this.globCache.clear();
    this.currentSizeBytes = 0;
  }

  get size(): number {
    return this.store.size;
  }

  get sizeBytes(): number {
    return this.currentSizeBytes;
  }
}
