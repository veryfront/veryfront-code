/**
 * Cache Repository Implementations
 *
 * Provides project-scoped caching with automatic key prefixing.
 * Two implementations:
 * - MemoryCacheRepository: LRU-based, for testing and local dev
 * - MultiTierCacheRepository: L1 memory + L3 distributed backend for production
 *
 * @module repositories/cache/cache-repository
 */

import type { CacheBackend } from "#veryfront/cache/backend.ts";
import { type CacheTier, MultiTierCache } from "#veryfront/cache/multi-tier.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";
import type {
  CacheRepository,
  CacheRepositoryOptions,
  CacheStats,
  RepositoryContext,
} from "../types.ts";
import {
  assertLiteralCachePrefix,
  buildRepositoryScopedKey,
  snapshotRepositoryContext,
} from "../context.ts";
import {
  DEFAULT_REPOSITORY_CACHE_ENTRIES,
  DEFAULT_REPOSITORY_CACHE_NAME,
  DEFAULT_REPOSITORY_CACHE_TTL_SECONDS,
  MAX_REPOSITORY_CACHE_ENTRIES,
  MAX_REPOSITORY_CACHE_KEY_LENGTH,
  MAX_REPOSITORY_CACHE_TTL_SECONDS,
} from "../limits.ts";

function invalidArgument(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function normalizeMaxEntries(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 ||
    value > MAX_REPOSITORY_CACHE_ENTRIES
  ) {
    invalidArgument("Cache maxEntries must be a positive integer within the supported range");
  }
  return value;
}

function normalizeTtl(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isFinite(value) || value <= 0 ||
    value > MAX_REPOSITORY_CACHE_TTL_SECONDS
  ) {
    invalidArgument("Cache TTL must be a positive finite number within the supported range");
  }
  return value;
}

function normalizeDeletedCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidArgument("Cache backend returned an invalid deletion count");
  }
  return value;
}

export function buildScopedKey(context: RepositoryContext, key: string): string {
  return buildRepositoryScopedKey(context, key);
}

export class MemoryCacheRepository<T = string> implements CacheRepository<T> {
  readonly context: RepositoryContext;
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly defaultTtlSeconds: number;
  private stats: CacheStats = {
    gets: 0,
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
  };

  constructor(options: {
    context: RepositoryContext;
    maxEntries?: number;
    defaultTtlSeconds?: number;
  }) {
    this.context = snapshotRepositoryContext(options.context);
    this.maxEntries = normalizeMaxEntries(
      options.maxEntries ?? DEFAULT_REPOSITORY_CACHE_ENTRIES,
    );
    this.defaultTtlSeconds = normalizeTtl(
      options.defaultTtlSeconds ?? DEFAULT_REPOSITORY_CACHE_TTL_SECONDS,
    );
  }

  private getScopedKey(key: string): string {
    return buildScopedKey(this.context, key);
  }

  private updateHitRate(): void {
    this.stats.hitRate = this.stats.gets ? this.stats.hits / this.stats.gets : 0;
  }

  async get(key: string): Promise<T | null> {
    const scopedKey = this.getScopedKey(key);
    this.stats.gets++;
    const entry = this.store.get(scopedKey);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(scopedKey);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    this.stats.hits++;
    this.updateHitRate();
    this.store.delete(scopedKey);
    this.store.set(scopedKey, entry);
    return entry.value;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const scopedKey = this.getScopedKey(key);
    const ttl = normalizeTtl(ttlSeconds ?? this.defaultTtlSeconds);
    this.stats.sets++;

    const replacingExistingEntry = this.store.delete(scopedKey);

    // LRU eviction: remove oldest entry if at capacity
    if (this.store.size >= this.maxEntries && !replacingExistingEntry) {
      this.pruneExpiredEntries(Date.now());
      const oldest = this.store.keys().next().value;
      if (this.store.size >= this.maxEntries && oldest !== undefined) {
        this.store.delete(oldest);
      }
    }

    this.store.set(scopedKey, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async delete(key: string): Promise<void> {
    const scopedKey = this.getScopedKey(key);
    this.stats.deletes++;
    this.store.delete(scopedKey);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    assertLiteralCachePrefix(prefix);
    const scopedPrefix = this.getScopedKey(prefix);
    let deleted = 0;

    for (const key of this.store.keys()) {
      if (!key.startsWith(scopedPrefix)) continue;
      this.store.delete(key);
      deleted++;
      this.stats.deletes++;
    }

    return deleted;
  }

  async has(key: string): Promise<boolean> {
    const scopedKey = this.getScopedKey(key);
    const entry = this.store.get(scopedKey);

    if (!entry) return false;

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(scopedKey);
      return false;
    }

    this.store.delete(scopedKey);
    this.store.set(scopedKey, entry);
    return true;
  }

  async clear(): Promise<void> {
    this.stats.deletes += this.store.size;
    this.store.clear();
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  /** Get raw store size (for testing) */
  get size(): number {
    return this.store.size;
  }

  private pruneExpiredEntries(now: number): void {
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) this.store.delete(key);
    }
  }
}

class BackendTierAdapter implements CacheTier<string> {
  readonly getRemainingTtlSeconds?: (key: string) => Promise<number | null>;
  private readonly getEntry: (key: string) => Promise<string | null>;
  private readonly setEntry: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
  private readonly deleteEntry: (key: string) => Promise<void>;

  constructor(
    readonly name: string,
    backend: CacheBackend,
  ) {
    let get: unknown;
    let set: unknown;
    let del: unknown;
    let getRemainingTtlSeconds: unknown;
    try {
      get = Reflect.get(backend, "get");
      set = Reflect.get(backend, "set");
      del = Reflect.get(backend, "del");
      getRemainingTtlSeconds = Reflect.get(backend, "getRemainingTtlSeconds");
    } catch {
      invalidArgument("Cache backend methods must be readable");
    }
    if (typeof get !== "function" || typeof set !== "function" || typeof del !== "function") {
      invalidArgument("Cache backend must provide get, set, and del functions");
    }
    if (
      getRemainingTtlSeconds !== undefined && typeof getRemainingTtlSeconds !== "function"
    ) {
      invalidArgument("Cache backend getRemainingTtlSeconds must be a function");
    }

    this.getEntry = async (key) => {
      const value = await Reflect.apply(get, backend, [key]);
      if (value !== null && typeof value !== "string") {
        invalidArgument("Cache backend get must resolve to a string or null");
      }
      return value;
    };
    this.setEntry = (key, value, ttlSeconds) =>
      Reflect.apply(set, backend, [key, value, ttlSeconds]) as Promise<void>;
    this.deleteEntry = (key) => Reflect.apply(del, backend, [key]) as Promise<void>;
    if (getRemainingTtlSeconds) {
      this.getRemainingTtlSeconds = async (key) => {
        const value = await Reflect.apply(getRemainingTtlSeconds, backend, [key]);
        return value === null ? null : normalizeTtl(value);
      };
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.getEntry(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.setEntry(key, value, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.deleteEntry(key);
  }
}

/**
 * Lets ordinary key operations run concurrently while giving scope-wide
 * invalidation an exclusive, linearizable boundary.
 */
class RepositoryOperationGate {
  private activeOperations = 0;
  private drained = Promise.resolve();
  private resolveDrained: (() => void) | undefined;
  private exclusiveTail = Promise.resolve();

  async run<R>(operation: () => Promise<R>): Promise<R> {
    while (true) {
      const observedTail = this.exclusiveTail;
      await observedTail;
      if (observedTail !== this.exclusiveTail) continue;

      if (this.activeOperations === 0) {
        this.drained = new Promise<void>((resolve) => {
          this.resolveDrained = resolve;
        });
      }
      this.activeOperations++;
      break;
    }

    try {
      return await operation();
    } finally {
      this.activeOperations--;
      if (this.activeOperations === 0) {
        this.resolveDrained?.();
        this.resolveDrained = undefined;
      }
    }
  }

  async runExclusive<R>(operation: () => Promise<R>): Promise<R> {
    const previousTail = this.exclusiveTail;
    let release!: () => void;
    const exclusive = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.exclusiveTail = previousTail.then(() => exclusive);

    await previousTail;
    if (this.activeOperations > 0) await this.drained;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class MultiTierCacheRepository implements CacheRepository<string> {
  readonly context: RepositoryContext;
  private readonly cache: MultiTierCache<string>;
  private readonly l1: MemoryTier;
  private readonly deleteByPattern?: (pattern: string) => Promise<number>;
  private readonly operationGate = new RepositoryOperationGate();
  private localStats: { deletes: number } = { deletes: 0 };

  constructor(options: {
    context: RepositoryContext;
    backend: CacheBackend;
    defaultTtlSeconds?: number;
    maxL1Entries?: number;
    name?: string;
  }) {
    this.context = snapshotRepositoryContext(options.context);
    const name = options.name ?? DEFAULT_REPOSITORY_CACHE_NAME;
    let deleteByPattern: unknown;
    try {
      deleteByPattern = Reflect.get(options.backend, "delByPattern");
    } catch {
      invalidArgument("Cache backend delByPattern must be readable");
    }
    if (deleteByPattern !== undefined && typeof deleteByPattern !== "function") {
      invalidArgument("Cache backend delByPattern must be a function");
    }
    if (deleteByPattern) {
      this.deleteByPattern = (pattern) =>
        Reflect.apply(deleteByPattern, options.backend, [pattern]) as Promise<number>;
    }

    this.l1 = new MemoryTier(
      normalizeMaxEntries(options.maxL1Entries ?? DEFAULT_REPOSITORY_CACHE_ENTRIES),
    );
    const l3 = new BackendTierAdapter("l3-distributed", options.backend);

    this.cache = new MultiTierCache({
      name,
      l1: this.l1,
      l3,
      defaultTtlSeconds: normalizeTtl(
        options.defaultTtlSeconds ?? DEFAULT_REPOSITORY_CACHE_TTL_SECONDS,
      ),
      backfillOnHit: true,
      asyncBackfill: false,
    });
  }

  private getScopedKey(key: string): string {
    return buildScopedKey(this.context, key);
  }

  async get(key: string): Promise<string | null> {
    const scopedKey = this.getScopedKey(key);
    return await this.operationGate.run(() => this.cache.get(scopedKey));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const scopedKey = this.getScopedKey(key);
    await this.operationGate.run(() => this.cache.set(scopedKey, value, ttlSeconds));
  }

  async delete(key: string): Promise<void> {
    const scopedKey = this.getScopedKey(key);
    await this.operationGate.run(async () => {
      await this.cache.delete(scopedKey);
      this.localStats.deletes++;
    });
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    assertLiteralCachePrefix(prefix);
    const scopedPrefix = this.getScopedKey(prefix);
    if (scopedPrefix.length >= MAX_REPOSITORY_CACHE_KEY_LENGTH) {
      invalidArgument("Scoped cache prefix exceeds the supported pattern length");
    }
    if (!this.deleteByPattern) {
      throw NOT_SUPPORTED.create({
        detail: "The configured cache backend does not support prefix deletion",
      });
    }
    const deleteByPattern = this.deleteByPattern;

    return await this.operationGate.runExclusive(async () => {
      const deleted = normalizeDeletedCount(await deleteByPattern(`${scopedPrefix}*`));
      this.l1.deleteByPrefix(scopedPrefix);
      this.localStats.deletes += deleted;
      return deleted;
    });
  }

  async has(key: string): Promise<boolean> {
    const scopedKey = this.getScopedKey(key);
    return await this.operationGate.run(async () => (await this.cache.get(scopedKey)) !== null);
  }

  async clear(): Promise<void> {
    const prefix = this.getScopedKey("");
    if (!this.deleteByPattern) {
      throw NOT_SUPPORTED.create({
        detail: "The configured cache backend does not support scope clearing",
      });
    }
    const deleteByPattern = this.deleteByPattern;

    await this.operationGate.runExclusive(async () => {
      const deleted = normalizeDeletedCount(await deleteByPattern(`${prefix}*`));
      this.l1.deleteByPrefix(prefix);
      this.localStats.deletes += deleted;
    });
  }

  getStats(): CacheStats {
    const multiTierStats = this.cache.getStats();

    return {
      gets: multiTierStats.gets,
      hits: multiTierStats.l1Hits + multiTierStats.l2Hits + multiTierStats.l3Hits,
      misses: multiTierStats.misses,
      sets: multiTierStats.sets,
      deletes: this.localStats.deletes,
      hitRate: multiTierStats.hitRate,
    };
  }
}

class MemoryTier implements CacheTier<string> {
  readonly name = "l1-memory";
  private readonly store = new Map<string, { value: string; expiresAt: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return null;
    }

    return remainingMs / 1000;
  }

  async set(
    key: string,
    value: string,
    ttlSeconds = DEFAULT_REPOSITORY_CACHE_TTL_SECONDS,
  ): Promise<void> {
    const ttl = normalizeTtl(ttlSeconds);
    const replacingExistingEntry = this.store.delete(key);
    if (this.store.size >= this.maxEntries && !replacingExistingEntry) {
      this.pruneExpiredEntries(Date.now());
      const oldest = this.store.keys().next().value;
      if (this.store.size >= this.maxEntries && oldest !== undefined) {
        this.store.delete(oldest);
      }
    }

    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Drop every entry whose key starts with `prefix` (tier-wide invalidation
   * for the repository's deleteByPrefix/clear). */
  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  private pruneExpiredEntries(now: number): void {
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) this.store.delete(key);
    }
  }
}

export function createMemoryCacheRepository<T = string>(
  context: RepositoryContext,
  options?: CacheRepositoryOptions,
): CacheRepository<T> {
  return new MemoryCacheRepository<T>({
    context,
    maxEntries: options?.maxEntries,
    defaultTtlSeconds: options?.defaultTtlSeconds,
  });
}

export function createMultiTierCacheRepository(
  context: RepositoryContext,
  backend: CacheBackend,
  options?: CacheRepositoryOptions,
): CacheRepository<string> {
  return new MultiTierCacheRepository({
    context,
    backend,
    defaultTtlSeconds: options?.defaultTtlSeconds,
    maxL1Entries: options?.maxEntries,
    name: options?.name,
  });
}
