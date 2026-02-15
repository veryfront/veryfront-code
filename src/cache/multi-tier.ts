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

export class MultiTierCache<T = string> {
  private readonly config:
    & Required<Omit<MultiTierCacheConfig<T>, "l1" | "l2" | "l3">>
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

  get(key: string): Promise<T | null> {
    return withSpan(
      SpanNames.CACHE_MULTI_TIER_GET,
      async (span?: Span): Promise<T | null> => {
        this.stats.gets++;
        span?.setAttribute("cache.name", this.config.name);
        span?.setAttribute("cache.key", key);

        const l1Value = await this.getFromTier(this.config.l1, key, "l1");
        if (l1Value !== null) return l1Value;

        const l2Value = await this.getFromTier(this.config.l2, key, "l2");
        if (l2Value !== null) {
          await this.maybeAwaitBackfill(this.backfill(key, l2Value, ["l1"]));
          return l2Value;
        }

        const l3Value = await this.getFromTier(this.config.l3, key, "l3");
        if (l3Value !== null) {
          await this.maybeAwaitBackfill(this.backfill(key, l3Value, ["l1", "l2"]));
          return l3Value;
        }

        this.stats.misses++;
        span?.setAttribute("cache.hit_tier", "miss");
        return null;
      },
      { "cache.operation": "get" },
    );
  }

  set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return withSpan(
      SpanNames.CACHE_MULTI_TIER_SET,
      async (span?: Span): Promise<void> => {
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
            logger.error(`[${this.config.name}] Set error in ${tier.name}`, {
              key: key.slice(-60),
              error: error instanceof Error ? error.message : String(error),
            });
          })
        );

        if (this.config.asyncBackfill) {
          void Promise.all(setOps);
          return;
        }

        await Promise.all(setOps);
      },
      { "cache.operation": "set" },
    );
  }

  async delete(key: string): Promise<void> {
    const tiers = [this.config.l1, this.config.l2, this.config.l3].filter(
      (t): t is CacheTier<T> => t !== undefined && t.delete !== undefined,
    );

    await Promise.all(
      tiers.map((tier) =>
        tier.delete?.(key).catch((error) => {
          logger.error(`[${this.config.name}] Delete error in ${tier.name}`, { key, error });
        })
      ),
    );
  }

  async getOrCompute(key: string, computeFn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const value = await computeFn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async getBatch(keys: string[]): Promise<Map<string, T | null>> {
    if (keys.length === 0) return new Map();

    const results = new Map<string, T | null>();
    let remainingKeys = [...keys];
    const backfillPromises: Promise<void>[] = [];

    if (this.config.l1 && remainingKeys.length > 0) {
      remainingKeys = await this.getBatchFromTier(this.config.l1, remainingKeys, "l1", results);
    }

    if (this.config.l2 && remainingKeys.length > 0) {
      remainingKeys = await this.getBatchFromTier(
        this.config.l2,
        remainingKeys,
        "l2",
        results,
        (k, v) => {
          backfillPromises.push(this.backfill(k, v, ["l1"]));
        },
      );
    }

    if (this.config.l3 && remainingKeys.length > 0) {
      try {
        const l3Results = this.config.l3.getBatch
          ? await this.config.l3.getBatch(remainingKeys)
          : await this.individualGets(this.config.l3, remainingKeys);

        for (const [k, v] of l3Results) {
          if (v !== null) {
            results.set(k, v);
            this.stats.l3Hits++;
            backfillPromises.push(this.backfill(k, v, ["l1", "l2"]));
          } else {
            results.set(k, null);
            this.stats.misses++;
          }
        }
      } catch (error) {
        logger.error(`[${this.config.name}] L3 getBatch error`, {
          keyCount: remainingKeys.length,
          error,
        });
      }
    }

    for (const k of remainingKeys) {
      if (!results.has(k)) {
        results.set(k, null);
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

  getStats(): CacheStats & { hitRate: number } {
    const totalHits = this.stats.l1Hits + this.stats.l2Hits + this.stats.l3Hits;
    const hitRate = this.stats.gets > 0 ? totalHits / this.stats.gets : 0;
    return { ...this.stats, hitRate };
  }

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

  private async getFromTier(
    tier: CacheTier<T> | undefined,
    key: string,
    tierName: "l1" | "l2" | "l3",
  ): Promise<T | null> {
    if (!tier) return null;

    try {
      const value = await tier.get(key);
      if (value === null) return null;

      if (tierName === "l1") this.stats.l1Hits++;
      if (tierName === "l2") this.stats.l2Hits++;
      if (tierName === "l3") this.stats.l3Hits++;

      logger.debug(`[${this.config.name}] ${tierName.toUpperCase()} hit`, { key });
      return value;
    } catch (error) {
      logger.error(`[${this.config.name}] ${tierName.toUpperCase()} get error`, {
        key: key.slice(-60),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async getBatchFromTier(
    tier: CacheTier<T>,
    keys: string[],
    tierName: "l1" | "l2",
    results: Map<string, T | null>,
    onHit?: (key: string, value: T) => void,
  ): Promise<string[]> {
    try {
      const tierResults = tier.getBatch
        ? await tier.getBatch(keys)
        : await this.individualGets(tier, keys);

      for (const [k, v] of tierResults) {
        if (v === null) continue;

        results.set(k, v);
        if (tierName === "l1") this.stats.l1Hits++;
        if (tierName === "l2") this.stats.l2Hits++;
        onHit?.(k, v);
      }

      return keys.filter((k) => !results.has(k) || results.get(k) === null);
    } catch (error) {
      logger.error(`[${this.config.name}] ${tierName.toUpperCase()} getBatch error`, {
        keyCount: keys.length,
        error,
      });
      return keys;
    }
  }

  private async maybeAwaitBackfill(promise: Promise<void>): Promise<void> {
    if (this.config.asyncBackfill) {
      void promise;
      return;
    }
    await promise;
  }

  private backfill(key: string, value: T, tiers: ("l1" | "l2")[]): Promise<void> {
    if (!this.config.backfillOnHit) return Promise.resolve();

    this.stats.backfills++;
    const ttl = this.config.defaultTtlSeconds;

    const backfillOps: Promise<void>[] = [];

    if (tiers.includes("l1") && this.config.l1) {
      backfillOps.push(
        this.config.l1.set(key, value, ttl).catch((error) => {
          logger.error(`[${this.config.name}] L1 backfill error`, { key, error });
        }),
      );
    }

    if (tiers.includes("l2") && this.config.l2) {
      backfillOps.push(
        this.config.l2.set(key, value, ttl).catch((error) => {
          logger.error(`[${this.config.name}] L2 backfill error`, { key, error });
        }),
      );
    }

    return Promise.all(backfillOps).then(() => {});
  }

  private async individualGets(tier: CacheTier<T>, keys: string[]): Promise<Map<string, T | null>> {
    const results = await Promise.all(keys.map(async (key) => [key, await tier.get(key)] as const));
    return new Map(results);
  }
}
