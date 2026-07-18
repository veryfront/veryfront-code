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

import { rendererLogger as logger } from "#veryfront/utils";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import { type CacheTier, MultiTierCache } from "#veryfront/cache/multi-tier.ts";
import type {
  CacheRepository,
  CacheRepositoryOptions,
  CacheStats,
  RepositoryContext,
} from "../types.ts";

export function buildScopedKey(context: RepositoryContext, key: string): string {
  const { projectId, environment, versionId } = context;
  return `${projectId}:${environment}:${versionId}:${key}`;
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
    this.context = options.context;
    this.maxEntries = options.maxEntries ?? 500;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 300;
  }

  private getScopedKey(key: string): string {
    return buildScopedKey(this.context, key);
  }

  private updateHitRate(): void {
    this.stats.hitRate = this.stats.gets ? this.stats.hits / this.stats.gets : 0;
  }

  async get(key: string): Promise<T | null> {
    this.stats.gets++;

    const scopedKey = this.getScopedKey(key);
    const entry = this.store.get(scopedKey);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(scopedKey);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    this.stats.hits++;
    this.updateHitRate();
    return entry.value;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.stats.sets++;

    const scopedKey = this.getScopedKey(key);
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;

    // LRU eviction: remove oldest entry if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(scopedKey)) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }

    this.store.set(scopedKey, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.stats.deletes++;
    this.store.delete(this.getScopedKey(key));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
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

    if (Date.now() > entry.expiresAt) {
      this.store.delete(scopedKey);
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    const prefix =
      `${this.context.projectId}:${this.context.environment}:${this.context.versionId}:`;

    for (const key of this.store.keys()) {
      if (!key.startsWith(prefix)) continue;
      this.store.delete(key);
      this.stats.deletes++;
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  /** Get raw store size (for testing) */
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
  private readonly name: string;
  private localStats: { deletes: number } = { deletes: 0 };

  constructor(options: {
    context: RepositoryContext;
    backend: CacheBackend;
    defaultTtlSeconds?: number;
    maxL1Entries?: number;
    name?: string;
  }) {
    this.context = options.context;
    this.backend = options.backend;
    this.name = options.name ?? "multi-tier-cache";

    this.l1 = new MemoryTier(options.maxL1Entries ?? 500);
    const l3 = new BackendTierAdapter("l3-distributed", options.backend);

    this.cache = new MultiTierCache({
      name: this.name,
      l1: this.l1,
      l3,
      defaultTtlSeconds: options.defaultTtlSeconds ?? 300,
      backfillOnHit: true,
      asyncBackfill: true,
    });
  }

  private getScopedKey(key: string): string {
    return buildScopedKey(this.context, key);
  }

  async get(key: string): Promise<string | null> {
    return this.cache.get(this.getScopedKey(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.cache.set(this.getScopedKey(key), value, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    this.localStats.deletes++;
    await this.cache.delete(this.getScopedKey(key));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const scopedPrefix = this.getScopedKey(prefix);

    // Wipe L1 up-front so concurrent reads during the (async) L3 delete miss
    // L1 quickly. We wipe again after L3 resolves (below) to drop any entry a
    // racing get() backfilled from a not-yet-deleted L3 value — otherwise that
    // stale entry would survive in L1 until its TTL (the bug #1989 fixes).
    this.l1.deleteByPrefix(scopedPrefix);

    if (!this.backend.delByPattern) {
      logger.debug(`[${this.name}] deleteByPrefix not supported by backend`, { prefix });
      return 0;
    }

    const deleted = await this.backend.delByPattern(`${scopedPrefix}*`);
    // Second wipe: L3 is now gone, so anything re-backfilled into L1 during the
    // await window is removed and cannot be repopulated from L3.
    this.l1.deleteByPrefix(scopedPrefix);
    this.localStats.deletes += deleted;
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async clear(): Promise<void> {
    const prefix =
      `${this.context.projectId}:${this.context.environment}:${this.context.versionId}:`;
    // Wipe L1 before and after the L3 delete (see deleteByPrefix) so racing
    // backfills can't leave a stale entry in the in-memory tier.
    this.l1.deleteByPrefix(prefix);
    await this.backend.delByPattern?.(`${prefix}*`);
    this.l1.deleteByPrefix(prefix);
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

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

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

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }

    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
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
