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
  private readonly name: string;
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
    name?: string;
  }) {
    this.context = options.context;
    this.maxEntries = options.maxEntries ?? 500;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 300;
    this.name = options.name ?? "memory-cache";
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
  constructor(
    readonly name: string,
    private readonly backend: CacheBackend,
  ) {}

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

    const l1 = new MemoryTier(options.maxL1Entries ?? 500);
    const l3 = new BackendTierAdapter("l3-distributed", options.backend);

    this.cache = new MultiTierCache({
      name: this.name,
      l1,
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

    if (!this.backend.delByPattern) {
      logger.debug(`[${this.name}] deleteByPrefix not supported by backend`, { prefix });
      return 0;
    }

    const deleted = await this.backend.delByPattern(`${scopedPrefix}*`);
    this.localStats.deletes += deleted;
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async clear(): Promise<void> {
    const prefix =
      `${this.context.projectId}:${this.context.environment}:${this.context.versionId}:`;
    await this.backend.delByPattern?.(`${prefix}*`);
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
}

export function createMemoryCacheRepository<T = string>(
  context: RepositoryContext,
  options?: CacheRepositoryOptions,
): CacheRepository<T> {
  return new MemoryCacheRepository<T>({
    context,
    maxEntries: options?.maxEntries,
    defaultTtlSeconds: options?.defaultTtlSeconds,
    name: options?.name,
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
