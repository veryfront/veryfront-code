import {
  MEMORY_CACHE_MAX_ENTRIES,
  MEMORY_CACHE_MAX_SIZE_BYTES,
} from "#veryfront/utils/constants/cache.ts";
import { INVALID_ARGUMENT, SERVICE_OVERLOADED } from "#veryfront/errors";
import type { CacheBackend } from "../types.ts";
import { buildBatchResults } from "../batch-results.ts";
import { type CacheGlob, compileCacheGlob } from "./glob.ts";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

const DEFAULT_TTL_SECONDS = 300;
const MAX_GLOB_CACHE_SIZE = 100;
const MAX_CACHE_ENTRIES = 1_000_000;
const MAX_CACHE_SIZE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_CACHE_KEY_LENGTH = 4096;
const MAX_CACHE_GLOB_LENGTH = 4096;
const MAX_CACHE_BATCH_ENTRIES = 1000;
const sizeEncoder = new TextEncoder();

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function capacityExceeded(message: string): never {
  throw SERVICE_OVERLOADED.create({ message });
}

function assertCacheKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" || key.length === 0 || key.length > MAX_CACHE_KEY_LENGTH ||
    containsUnsafeCacheStringCharacter(key)
  ) {
    invalidArgument(
      "Cache key must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }
}

function normalizeTtl(ttlSeconds: unknown): number {
  if (
    typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds < 0 ||
    ttlSeconds > MAX_CACHE_TTL_SECONDS
  ) {
    invalidArgument("Cache TTL must be a finite number within the supported range");
  }
  return ttlSeconds;
}

export class MemoryCacheBackend implements CacheBackend {
  readonly type = "memory" as const;
  private store = new Map<string, { value: string; expiresAt: number; sizeBytes: number }>();
  private globCache = new Map<string, CacheGlob>();
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;
  private currentSizeBytes = 0;

  constructor(maxEntries = MEMORY_CACHE_MAX_ENTRIES, options?: { maxSizeBytes?: number }) {
    if (
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_CACHE_ENTRIES
    ) {
      invalidArgument("Memory cache entry capacity must be a positive safe integer");
    }
    if (options !== undefined && (typeof options !== "object" || options === null)) {
      invalidArgument("Memory cache options must be an object");
    }
    let configuredMaxSize: unknown;
    try {
      configuredMaxSize = options === undefined ? undefined : Reflect.get(options, "maxSizeBytes");
    } catch {
      invalidArgument("Memory cache options must be readable");
    }
    const maxSizeBytes = configuredMaxSize ?? MEMORY_CACHE_MAX_SIZE_BYTES;
    if (
      typeof maxSizeBytes !== "number" || !Number.isSafeInteger(maxSizeBytes) ||
      maxSizeBytes < 1 ||
      maxSizeBytes > MAX_CACHE_SIZE_BYTES
    ) {
      invalidArgument("Memory cache byte capacity must be a positive safe integer");
    }
    this.maxEntries = maxEntries;
    this.maxSizeBytes = maxSizeBytes;
  }

  private estimateSize(key: string, value: string): number {
    return sizeEncoder.encode(key).byteLength + sizeEncoder.encode(value).byteLength;
  }

  private purgeExpired(now = Date.now()): void {
    for (const [key, entry] of this.store) {
      if (now < entry.expiresAt) continue;
      this.currentSizeBytes -= entry.sizeBytes;
      this.store.delete(key);
    }
  }

  private evictOldest(): void {
    const oldest = this.store.keys().next().value as string | undefined;
    if (!oldest) return;
    const entry = this.store.get(oldest);
    if (entry) this.currentSizeBytes -= entry.sizeBytes;
    this.store.delete(oldest);
  }

  async get(key: string): Promise<string | null> {
    assertCacheKey(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.currentSizeBytes -= entry.sizeBytes;
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    assertCacheKey(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.currentSizeBytes -= entry.sizeBytes;
      this.store.delete(key);
      return null;
    }

    return remainingMs / 1000;
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (!Array.isArray(keys) || keys.length > MAX_CACHE_BATCH_ENTRIES) {
      invalidArgument("Cache batch exceeds the supported entry count");
    }
    for (const key of keys) assertCacheKey(key);
    const now = Date.now();

    const results = buildBatchResults(keys, (key) => {
      const entry = this.store.get(key);
      if (!entry) return null;

      if (now >= entry.expiresAt) {
        this.currentSizeBytes -= entry.sizeBytes;
        this.store.delete(key);
        return null;
      }

      return entry.value;
    });

    return results;
  }

  async set(key: string, value: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    assertCacheKey(key);
    if (typeof value !== "string") invalidArgument("Cache value must be a string");
    const ttl = normalizeTtl(ttlSeconds);
    const entrySize = this.estimateSize(key, value);

    if (entrySize > this.maxSizeBytes) {
      capacityExceeded("Cache entry exceeds the configured byte capacity");
    }

    this.purgeExpired();

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
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000, sizeBytes: entrySize });
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (!Array.isArray(entries) || entries.length > MAX_CACHE_BATCH_ENTRIES) {
      invalidArgument("Cache batch exceeds the supported entry count");
    }
    const prepared = entries.map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        invalidArgument("Cache batch entry must be an object");
      }
      let key: unknown;
      let value: unknown;
      let ttl: unknown;
      try {
        key = Reflect.get(entry, "key");
        value = Reflect.get(entry, "value");
        ttl = Reflect.get(entry, "ttl");
      } catch {
        invalidArgument("Cache batch entry must be readable");
      }
      assertCacheKey(key);
      if (typeof value !== "string") invalidArgument("Cache value must be a string");
      const normalizedTtl = normalizeTtl(ttl ?? DEFAULT_TTL_SECONDS);
      const entrySize = this.estimateSize(key, value);
      if (entrySize > this.maxSizeBytes) {
        capacityExceeded("Cache entry exceeds the configured byte capacity");
      }
      return { key, value, ttl: normalizedTtl, entrySize };
    });

    const now = Date.now();
    this.purgeExpired(now);

    for (const { key, value, ttl, entrySize } of prepared) {
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
        expiresAt: now + ttl * 1000,
        sizeBytes: entrySize,
      });
    }
  }

  async del(key: string): Promise<void> {
    assertCacheKey(key);
    const entry = this.store.get(key);
    if (entry) this.currentSizeBytes -= entry.sizeBytes;
    this.store.delete(key);
  }

  async delByPattern(pattern: string): Promise<number> {
    if (typeof pattern !== "string" || pattern.length > MAX_CACHE_GLOB_LENGTH) {
      invalidArgument("Cache pattern must be a bounded string");
    }
    let glob = this.globCache.get(pattern);
    if (!glob) {
      glob = compileCacheGlob(pattern) ?? undefined;
      if (!glob) return 0;

      if (this.globCache.size >= MAX_GLOB_CACHE_SIZE) {
        const firstKey = this.globCache.keys().next().value as string | undefined;
        if (firstKey !== undefined) this.globCache.delete(firstKey);
      }

      this.globCache.set(pattern, glob);
    }

    let deleted = 0;
    for (const key of this.store.keys()) {
      if (!glob.test(key)) continue;
      const entry = this.store.get(key);
      if (entry) this.currentSizeBytes -= entry.sizeBytes;
      this.store.delete(key);
      deleted++;
    }

    return deleted;
  }

  clear(): void {
    this.store.clear();
    this.globCache.clear();
    this.currentSizeBytes = 0;
  }

  get size(): number {
    this.purgeExpired();
    return this.store.size;
  }

  get sizeBytes(): number {
    this.purgeExpired();
    return this.currentSizeBytes;
  }
}
