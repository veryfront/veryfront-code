/**
 * Multi-Tier Cache Abstraction
 *
 * Generic implementation for L1 → L2 → L3 cache flows with automatic backfill.
 * This provides consistent caching behavior across the codebase:
 *
 * - L1: In-memory (fastest, per-pod, lost on restart)
 * - L2: Local disk (fast, per-pod, survives restart)
 * - L3: Distributed (Redis/API, cross-pod, shared state)
 *
 * When a cache hit occurs at a lower tier (e.g., L3), the value is automatically
 * backfilled to higher tiers (L1, L2) for faster subsequent access.
 *
 * @module cache/multi-tier
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";

/**
 * Generic cache tier interface.
 * Each tier implements async get/set operations.
 */
export interface CacheTier<T = string> {
  /** Tier name for logging/debugging */
  readonly name: string;

  /** Get a value from this tier */
  get(key: string): Promise<T | null>;

  /** Set a value in this tier */
  set(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /** Delete a value from this tier */
  delete?(key: string): Promise<void>;

  /** Check if key exists (optional, uses get if not implemented) */
  has?(key: string): Promise<boolean>;

  /** Get multiple values (optional batch operation) */
  getBatch?(keys: string[]): Promise<Map<string, T | null>>;

  /** Set multiple values (optional batch operation) */
  setBatch?(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void>;
}

/**
 * Configuration for multi-tier cache.
 */
export interface MultiTierCacheConfig<T = string> {
  /** Cache name for logging */
  name: string;

  /** L1: Memory tier (optional) */
  l1?: CacheTier<T>;

  /** L2: Disk tier (optional) */
  l2?: CacheTier<T>;

  /** L3: Distributed tier (optional) */
  l3?: CacheTier<T>;

  /** Default TTL in seconds for set operations */
  defaultTtlSeconds?: number;

  /** Whether to backfill higher tiers on lower-tier hits (default: true) */
  backfillOnHit?: boolean;

  /** Whether to use fire-and-forget for backfill operations (default: true) */
  asyncBackfill?: boolean;
}

/**
 * Cache hit statistics.
 */
export interface CacheStats {
  /** Total get operations */
  gets: number;

  /** Hits at each tier */
  l1Hits: number;
  l2Hits: number;
  l3Hits: number;

  /** Total misses (no tier had the value) */
  misses: number;

  /** Set operations */
  sets: number;

  /** Backfill operations triggered */
  backfills: number;
}

/**
 * Multi-tier cache implementation.
 *
 * Provides automatic fallthrough from L1 → L2 → L3 with backfill on hits.
 *
 * @example
 * ```typescript
 * const cache = new MultiTierCache({
 *   name: "http-module",
 *   l1: new MemoryTier(),
 *   l3: await CacheBackends.httpModule(),
 *   defaultTtlSeconds: 86400,
 * });
 *
 * const value = await cache.get("my-key");
 * // If found in L3, automatically backfills L1
 * ```
 */
export class MultiTierCache<T = string> {
  private readonly config:
    & Required<
      Omit<MultiTierCacheConfig<T>, "l1" | "l2" | "l3">
    >
    & Pick<MultiTierCacheConfig<T>, "l1" | "l2" | "l3">;

  private stats: CacheStats = {
    gets: 0,
    l1Hits: 0,
    l2Hits: 0,
    l3Hits: 0,
    misses: 0,
    sets: 0,
    backfills: 0,
  };

  constructor(config: MultiTierCacheConfig<T>) {
    this.config = {
      defaultTtlSeconds: 300,
      backfillOnHit: true,
      asyncBackfill: true,
      ...config,
    };
  }

  /**
   * Get a value from the cache.
   *
   * Checks tiers in order: L1 → L2 → L3.
   * On hit at a lower tier, backfills higher tiers.
   */
  get(key: string): Promise<T | null> {
    return withSpan(
      SpanNames.CACHE_MULTI_TIER_GET,
      async (span?: Span) => {
        this.stats.gets++;
        span?.setAttribute("cache.name", this.config.name);
        span?.setAttribute("cache.key", key);

        // L1: Memory
        if (this.config.l1) {
          try {
            const value = await this.config.l1.get(key);
            if (value !== null) {
              this.stats.l1Hits++;
              span?.setAttribute("cache.hit_tier", "l1");
              logger.debug(`[${this.config.name}] L1 hit`, { key });
              return value;
            }
          } catch (error) {
            logger.debug(`[${this.config.name}] L1 get error`, { key, error });
          }
        }

        // L2: Disk
        if (this.config.l2) {
          try {
            const value = await this.config.l2.get(key);
            if (value !== null) {
              this.stats.l2Hits++;
              span?.setAttribute("cache.hit_tier", "l2");
              logger.debug(`[${this.config.name}] L2 hit`, { key });
              const backfillPromise = this.backfill(key, value, ["l1"]);
              if (this.config.asyncBackfill) {
                void backfillPromise;
              } else {
                await backfillPromise;
              }
              return value;
            }
          } catch (error) {
            logger.debug(`[${this.config.name}] L2 get error`, { key, error });
          }
        }

        // L3: Distributed
        if (this.config.l3) {
          try {
            const value = await this.config.l3.get(key);
            if (value !== null) {
              this.stats.l3Hits++;
              span?.setAttribute("cache.hit_tier", "l3");
              logger.debug(`[${this.config.name}] L3 hit`, { key });
              const backfillPromise = this.backfill(key, value, ["l1", "l2"]);
              if (this.config.asyncBackfill) {
                void backfillPromise;
              } else {
                await backfillPromise;
              }
              return value;
            }
          } catch (error) {
            logger.debug(`[${this.config.name}] L3 get error`, { key, error });
          }
        }

        this.stats.misses++;
        span?.setAttribute("cache.hit_tier", "miss");
        return null;
      },
      { "cache.operation": "get" },
    );
  }

  /**
   * Set a value in all tiers.
   *
   * Writes to all configured tiers in parallel (or sequentially if asyncBackfill=false).
   */
  set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return withSpan(
      SpanNames.CACHE_MULTI_TIER_SET,
      (span?: Span) => {
        this.stats.sets++;
        const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
        span?.setAttribute("cache.name", this.config.name);
        span?.setAttribute("cache.key", key);
        span?.setAttribute("cache.ttl_seconds", ttl);

        const tiers = [this.config.l1, this.config.l2, this.config.l3].filter(
          (t): t is CacheTier<T> => t !== undefined,
        );

        const setOps = tiers.map((tier) =>
          tier.set(key, value, ttl).catch((error) => {
            logger.debug(`[${this.config.name}] Set error in ${tier.name}`, { key, error });
          })
        );

        if (this.config.asyncBackfill) {
          // Fire-and-forget for performance (don't await)
          void Promise.all(setOps);
          return Promise.resolve();
        }

        // Wait for all tiers
        return Promise.all(setOps).then(() => {});
      },
      { "cache.operation": "set" },
    );
  }

  /**
   * Delete a value from all tiers.
   */
  async delete(key: string): Promise<void> {
    const tiers = [this.config.l1, this.config.l2, this.config.l3].filter(
      (t): t is CacheTier<T> => t !== undefined && t.delete !== undefined,
    );

    await Promise.all(
      tiers.map((tier) =>
        tier.delete?.(key).catch((error) => {
          logger.debug(`[${this.config.name}] Delete error in ${tier.name}`, { key, error });
        })
      ),
    );
  }

  /**
   * Get or compute a value.
   *
   * If the key exists in any tier, returns it.
   * Otherwise, calls the compute function and stores the result in all tiers.
   */
  async getOrCompute(
    key: string,
    computeFn: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const value = await computeFn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Batch get multiple values.
   *
   * Uses batch operations where available for efficiency.
   * Returns a map of key → value (null if not found).
   */
  async getBatch(keys: string[]): Promise<Map<string, T | null>> {
    if (keys.length === 0) return new Map();

    const results = new Map<string, T | null>();
    let remainingKeys = [...keys];

    const backfillPromises: Promise<void>[] = [];

    // Check L1
    if (this.config.l1 && remainingKeys.length > 0) {
      try {
        const l1Results = this.config.l1.getBatch
          ? await this.config.l1.getBatch(remainingKeys)
          : await this.individualGets(this.config.l1, remainingKeys);

        for (const [key, value] of l1Results) {
          if (value !== null) {
            results.set(key, value);
            this.stats.l1Hits++;
          }
        }
        remainingKeys = remainingKeys.filter((k) => !results.has(k) || results.get(k) === null);
      } catch (error) {
        logger.debug(`[${this.config.name}] L1 getBatch error`, {
          keyCount: remainingKeys.length,
          error,
        });
      }
    }

    // Check L2
    if (this.config.l2 && remainingKeys.length > 0) {
      try {
        const l2Results = this.config.l2.getBatch
          ? await this.config.l2.getBatch(remainingKeys)
          : await this.individualGets(this.config.l2, remainingKeys);

        for (const [key, value] of l2Results) {
          if (value !== null) {
            results.set(key, value);
            this.stats.l2Hits++;
            backfillPromises.push(this.backfill(key, value, ["l1"]));
          }
        }
        remainingKeys = remainingKeys.filter((k) => !results.has(k) || results.get(k) === null);
      } catch (error) {
        logger.debug(`[${this.config.name}] L2 getBatch error`, {
          keyCount: remainingKeys.length,
          error,
        });
      }
    }

    // Check L3
    if (this.config.l3 && remainingKeys.length > 0) {
      try {
        const l3Results = this.config.l3.getBatch
          ? await this.config.l3.getBatch(remainingKeys)
          : await this.individualGets(this.config.l3, remainingKeys);

        for (const [key, value] of l3Results) {
          if (value !== null) {
            results.set(key, value);
            this.stats.l3Hits++;
            backfillPromises.push(this.backfill(key, value, ["l1", "l2"]));
          } else {
            results.set(key, null);
            this.stats.misses++;
          }
        }
      } catch (error) {
        logger.debug(`[${this.config.name}] L3 getBatch error`, {
          keyCount: remainingKeys.length,
          error,
        });
      }
    }

    // Mark remaining as misses
    for (const key of remainingKeys) {
      if (!results.has(key)) {
        results.set(key, null);
        this.stats.misses++;
      }
    }

    if (backfillPromises.length > 0) {
      if (this.config.asyncBackfill) {
        void Promise.all(backfillPromises);
      } else {
        await Promise.all(backfillPromises);
      }
    }

    return results;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats & { hitRate: number } {
    const totalHits = this.stats.l1Hits + this.stats.l2Hits + this.stats.l3Hits;
    const hitRate = this.stats.gets > 0 ? totalHits / this.stats.gets : 0;
    return { ...this.stats, hitRate };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      gets: 0,
      l1Hits: 0,
      l2Hits: 0,
      l3Hits: 0,
      misses: 0,
      sets: 0,
      backfills: 0,
    };
  }

  /**
   * Backfill higher tiers with a value found at a lower tier.
   */
  private backfill(key: string, value: T, tiers: ("l1" | "l2")[]): Promise<void> {
    if (!this.config.backfillOnHit) return Promise.resolve();

    this.stats.backfills++;
    const ttl = this.config.defaultTtlSeconds;

    const backfillOps: Promise<void>[] = [];

    if (tiers.includes("l1") && this.config.l1) {
      backfillOps.push(
        this.config.l1.set(key, value, ttl).catch((error) => {
          logger.debug(`[${this.config.name}] L1 backfill error`, { key, error });
        }),
      );
    }

    if (tiers.includes("l2") && this.config.l2) {
      backfillOps.push(
        this.config.l2.set(key, value, ttl).catch((error) => {
          logger.debug(`[${this.config.name}] L2 backfill error`, { key, error });
        }),
      );
    }
    return Promise.all(backfillOps).then(() => {});
  }

  /**
   * Helper for individual gets when batch operation is not available.
   */
  private async individualGets(
    tier: CacheTier<T>,
    keys: string[],
  ): Promise<Map<string, T | null>> {
    const results = await Promise.all(
      keys.map(async (key) => [key, await tier.get(key)] as const),
    );
    return new Map(results);
  }
}

/**
 * Create a memory-backed cache tier from a CacheBackend.
 */
export function createMemoryTier(backend: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del?(key: string): Promise<void>;
  getBatch?(keys: string[]): Promise<Map<string, string | null>>;
  setBatch?(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void>;
}): CacheTier<string> {
  return {
    name: "memory",
    get: (key) => backend.get(key),
    set: (key, value, ttl) => backend.set(key, value, ttl),
    delete: backend.del?.bind(backend),
    getBatch: backend.getBatch?.bind(backend),
    setBatch: backend.setBatch?.bind(backend),
  };
}

/**
 * Create a distributed cache tier from a CacheBackend.
 */
export function createDistributedTier(backend: {
  readonly type: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del?(key: string): Promise<void>;
  getBatch?(keys: string[]): Promise<Map<string, string | null>>;
  setBatch?(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void>;
}): CacheTier<string> {
  return {
    name: `distributed-${backend.type}`,
    get: (key) => backend.get(key),
    set: (key, value, ttl) => backend.set(key, value, ttl),
    delete: backend.del?.bind(backend),
    getBatch: backend.getBatch?.bind(backend),
    setBatch: backend.setBatch?.bind(backend),
  };
}
