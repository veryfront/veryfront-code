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
import {
  DEFAULT_CACHE_TTL_SECONDS,
  requirePositiveIntegerCacheTtlSeconds,
} from "#veryfront/cache/backends/ttl.ts";
import { CACHE_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import type {
  CacheRepository,
  CacheRepositoryOptions,
  CacheStats,
  RepositoryContext,
} from "../types.ts";
import { AsyncOperationGate } from "./async-operation-gate.ts";
import { ExpiringLruStore } from "./expiring-lru-store.ts";
import { appendRepositoryCacheKey, createRepositoryCacheScope } from "./key-scope.ts";
import { isRepositoryCacheName } from "../constraints.ts";

export { buildScopedKey } from "./key-scope.ts";

const DEFAULT_REPOSITORY_CACHE_MAX_ENTRIES = 500;

export class MemoryCacheRepository<T = string> implements CacheRepository<T> {
  readonly context: RepositoryContext;
  private readonly store: ExpiringLruStore<T>;
  private readonly scopePrefix: string;
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
    const scope = createRepositoryCacheScope(options.context);
    this.context = scope.context;
    this.scopePrefix = scope.prefix;
    this.store = new ExpiringLruStore(
      options.maxEntries ?? DEFAULT_REPOSITORY_CACHE_MAX_ENTRIES,
    );
    this.defaultTtlSeconds = requirePositiveIntegerCacheTtlSeconds(
      options.defaultTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
    );
  }

  private getScopedKey(key: string): string {
    return appendRepositoryCacheKey(this.scopePrefix, key);
  }

  private updateHitRate(): void {
    this.stats.hitRate = this.stats.gets ? this.stats.hits / this.stats.gets : 0;
  }

  async get(key: string): Promise<T | null> {
    this.stats.gets++;

    const scopedKey = this.getScopedKey(key);
    const value = this.store.get(scopedKey);

    if (value === null) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    this.stats.hits++;
    this.updateHitRate();
    return value;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.stats.sets++;
    this.store.set(
      this.getScopedKey(key),
      value,
      ttlSeconds,
      this.defaultTtlSeconds,
    );
  }

  async delete(key: string): Promise<void> {
    this.stats.deletes++;
    this.store.delete(this.getScopedKey(key));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const deleted = this.store.deleteByPrefix(this.getScopedKey(prefix));
    this.stats.deletes += deleted;
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(this.getScopedKey(key));
  }

  async clear(): Promise<void> {
    this.stats.deletes += this.store.deleteByPrefix(this.scopePrefix);
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  /** Get the number of live entries (for diagnostics and tests). */
  get size(): number {
    return this.store.size;
  }
}

class BackendTierAdapter implements CacheTier<string> {
  readonly getRemainingTtlSeconds?: (key: string) => Promise<number | null>;

  constructor(
    readonly name: string,
    private readonly backend: CacheBackend,
  ) {
    if (backend.getRemainingTtlSeconds) {
      this.getRemainingTtlSeconds = backend.getRemainingTtlSeconds.bind(backend);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.backend.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.backend.set(key, value, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.backend.del(key);
  }
}

export class MultiTierCacheRepository implements CacheRepository<string> {
  readonly context: RepositoryContext;
  private readonly cache: MultiTierCache<string>;
  private readonly backend: CacheBackend;
  private readonly l1: MemoryTier;
  private readonly scopePrefix: string;
  private readonly name: string;
  private readonly operationGate = new AsyncOperationGate();
  private localStats: { deletes: number } = { deletes: 0 };

  constructor(options: {
    context: RepositoryContext;
    backend: CacheBackend;
    defaultTtlSeconds?: number;
    maxL1Entries?: number;
    name?: string;
  }) {
    const scope = createRepositoryCacheScope(options.context);
    this.context = scope.context;
    this.scopePrefix = scope.prefix;
    this.backend = options.backend;
    this.name = options.name ?? "multi-tier-cache";
    if (!isRepositoryCacheName(this.name)) {
      throw INVALID_ARGUMENT.create({
        detail:
          "Repository cache name must be a trimmed, well-formed 1-256 character string without control characters",
      });
    }

    this.l1 = new MemoryTier(
      options.maxL1Entries ?? DEFAULT_REPOSITORY_CACHE_MAX_ENTRIES,
    );
    const l3 = new BackendTierAdapter("l3-distributed", options.backend);

    this.cache = new MultiTierCache({
      name: this.name,
      l1: this.l1,
      l3,
      defaultTtlSeconds: requirePositiveIntegerCacheTtlSeconds(
        options.defaultTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
      ),
      backfillOnHit: true,
      // Prefix invalidation holds an exclusive operation gate. Waiting for L1
      // backfill keeps the shared get operation inside that gate, so a stale
      // backfill cannot finish after invalidation.
      asyncBackfill: false,
    });
  }

  private getScopedKey(key: string): string {
    return appendRepositoryCacheKey(this.scopePrefix, key);
  }

  get(key: string): Promise<string | null> {
    return this.operationGate.runShared(() => this.cache.get(this.getScopedKey(key)));
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    return this.operationGate.runShared(
      () => this.cache.set(this.getScopedKey(key), value, ttlSeconds),
    );
  }

  delete(key: string): Promise<void> {
    return this.operationGate.runShared(async () => {
      await this.cache.delete(this.getScopedKey(key));
      this.localStats.deletes++;
    });
  }

  private async deleteScopedPrefix(prefix: string): Promise<number> {
    const deleteByPattern = this.backend.delByPattern;
    if (!deleteByPattern) {
      throw CACHE_ERROR.create({
        detail: `Cache backend "${this.backend.type}" does not support pattern deletion`,
        context: { cacheName: this.name, backendType: this.backend.type },
      });
    }

    const scopedPrefix = this.getScopedKey(prefix);
    this.l1.deleteByPrefix(scopedPrefix);

    try {
      const deleted = await deleteByPattern.call(this.backend, `${scopedPrefix}*`);
      if (!Number.isSafeInteger(deleted) || deleted < 0) {
        throw CACHE_ERROR.create({
          detail: "Cache backend returned an invalid pattern-deletion count",
          context: { cacheName: this.name, backendType: this.backend.type },
        });
      }
      this.localStats.deletes += deleted;
      return deleted;
    } finally {
      // Defensive second wipe covers a backend that partially deletes before
      // rejecting, even though normal reads are held outside the exclusive gate.
      this.l1.deleteByPrefix(scopedPrefix);
    }
  }

  deleteByPrefix(prefix: string): Promise<number> {
    return this.operationGate.runExclusive(() => this.deleteScopedPrefix(prefix));
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  clear(): Promise<void> {
    return this.operationGate.runExclusive(async () => {
      await this.deleteScopedPrefix("");
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
  private readonly store: ExpiringLruStore<string>;

  constructor(maxEntries: number) {
    this.store = new ExpiringLruStore(maxEntries);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    return this.store.getRemainingTtlSeconds(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  ): Promise<void> {
    this.store.set(key, value, ttlSeconds, DEFAULT_CACHE_TTL_SECONDS);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Drop every entry whose key starts with `prefix` (tier-wide invalidation
   * for the repository's deleteByPrefix/clear). */
  deleteByPrefix(prefix: string): void {
    this.store.deleteByPrefix(prefix);
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
