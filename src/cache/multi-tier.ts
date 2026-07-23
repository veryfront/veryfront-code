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
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CACHE_ERROR } from "#veryfront/errors";
import { MAX_CACHE_TTL_SECONDS, resolveCacheTtlSeconds } from "#veryfront/cache/backends/ttl.ts";
import { MAX_BATCH_SIZE } from "#veryfront/utils/constants/limits.ts";

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

  /**
   * Get the remaining TTL (in seconds) for a key, if this tier tracks expiry.
   * Returns null when the key is absent or expired. Tiers that cannot report a
   * TTL must omit this method so callers can use their configured default.
   * Used so backfill to higher tiers preserves the source entry's remaining
   * lifetime instead of resurrecting a near-expired value with a fresh default.
   */
  getRemainingTtlSeconds?(key: string): Promise<number | null>;

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

interface KeyState {
  generation: number;
  activeOperations: number;
}

const MAX_INFLIGHT_COMPUTATIONS = 1_000;

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
  private readonly computations = new Map<
    string,
    { state: KeyState; generation: number; promise: Promise<T> }
  >();
  private readonly keyStates = new Map<string, KeyState>();
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(config: MultiTierCacheConfig<T>) {
    const resolvedConfig = {
      defaultTtlSeconds: 300,
      backfillOnHit: true,
      asyncBackfill: true,
      ...config,
    };
    validateConfig(resolvedConfig);
    this.config = resolvedConfig;
  }

  get(key: string): Promise<T | null> {
    return withSpan(
      SpanNames.CACHE_MULTI_TIER_GET,
      async (span?: Span): Promise<T | null> => {
        const state = this.retainKeyState(key);
        const generation = state.generation;
        try {
          this.stats.gets++;
          span?.setAttribute("cache.name", this.config.name);
          span?.setAttribute("cache.key_length", key.length);

          const l1Value = await this.getFromTier(this.config.l1, key, "l1");
          if (l1Value !== null) return l1Value;

          const l2Value = await this.getFromTier(this.config.l2, key, "l2");
          if (l2Value !== null) {
            await this.maybeAwaitBackfill(
              this.backfill(key, l2Value, ["l1"], state, generation, this.config.l2),
            );
            return l2Value;
          }

          const l3Value = await this.getFromTier(this.config.l3, key, "l3");
          if (l3Value !== null) {
            await this.maybeAwaitBackfill(
              this.backfill(
                key,
                l3Value,
                ["l1", "l2"],
                state,
                generation,
                this.config.l3,
              ),
            );
            return l3Value;
          }

          this.stats.misses++;
          span?.setAttribute("cache.hit_tier", "miss");
          return null;
        } finally {
          this.releaseKeyState(key, state);
        }
      },
      { "cache.operation": "get" },
    );
  }

  set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return withSpan(
      SpanNames.CACHE_MULTI_TIER_SET,
      async (span?: Span): Promise<void> => {
        const state = this.retainKeyState(key);
        try {
          this.stats.sets++;
          const ttl = resolveCacheTtlSeconds(
            ttlSeconds,
            this.config.defaultTtlSeconds,
          )!;
          const generation = this.advanceGeneration(state);

          span?.setAttribute("cache.name", this.config.name);
          span?.setAttribute("cache.key_length", key.length);
          span?.setAttribute("cache.ttl_seconds", ttl);

          await this.enqueueMutation(key, async () => {
            if (!this.isCurrentGeneration(key, state, generation)) return;
            await this.writeValue(key, value, ttl);
          });
        } finally {
          this.releaseKeyState(key, state);
        }
      },
      { "cache.operation": "set" },
    );
  }

  async delete(key: string): Promise<void> {
    const configuredTiers = [this.config.l1, this.config.l2, this.config.l3].filter(
      (tier): tier is CacheTier<T> => tier !== undefined,
    );
    const unsupported = configuredTiers.filter((tier) => !tier.delete).map((tier) => tier.name);
    if (unsupported.length > 0) {
      throw CACHE_ERROR.create({
        detail: `Delete is unsupported in cache tier(s): ${unsupported.join(", ")}`,
        context: { cacheName: this.config.name, unsupportedTiers: unsupported },
      });
    }

    const state = this.retainKeyState(key);
    try {
      const generation = this.advanceGeneration(state);

      await this.enqueueMutation(key, async () => {
        if (!this.isCurrentGeneration(key, state, generation)) return;

        const failedTiers: string[] = [];
        await Promise.all(
          configuredTiers.map((tier) =>
            tier.delete?.(key).catch((error) => {
              logger.error(`[${this.config.name}] Delete error in ${tier.name}`, {
                keyLength: key.length,
                errorName: error instanceof Error ? error.name : typeof error,
              });
              failedTiers.push(tier.name);
            })
          ),
        );

        if (failedTiers.length > 0) {
          throw CACHE_ERROR.create({
            detail: `Delete failed in cache tier(s): ${failedTiers.join(", ")}`,
            context: { cacheName: this.config.name, failedTiers },
          });
        }
      });
    } finally {
      this.releaseKeyState(key, state);
    }
  }

  async getOrCompute(key: string, computeFn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const ttl = resolveCacheTtlSeconds(ttlSeconds, this.config.defaultTtlSeconds)!;

    const state = this.retainKeyState(key);
    const generation = state.generation;
    let ownedComputation: Promise<T> | undefined;
    try {
      const existing = this.computations.get(key);
      if (
        existing?.state === state && existing.generation === generation
      ) return await existing.promise;

      ownedComputation = this.computeAndPublish(
        key,
        computeFn,
        ttl,
        state,
        generation,
      );

      if (this.computations.size < MAX_INFLIGHT_COMPUTATIONS) {
        this.computations.set(key, { state, generation, promise: ownedComputation });
      } else {
        logger.warn(`[${this.config.name}] Computation singleflight capacity reached`, {
          inflight: this.computations.size,
        });
      }
      return await ownedComputation;
    } finally {
      if (ownedComputation && this.computations.get(key)?.promise === ownedComputation) {
        this.computations.delete(key);
      }
      this.releaseKeyState(key, state);
    }
  }

  async getBatch(keys: string[]): Promise<Map<string, T | null>> {
    if (keys.length === 0) return new Map();
    if (keys.length > MAX_BATCH_SIZE) {
      throw new RangeError(`Multi-tier cache batches may contain at most ${MAX_BATCH_SIZE} keys`);
    }

    // Batch results are maps, so duplicate requested keys collapse to one cache
    // lookup for statistics just as they collapse to one returned entry.
    const uniqueKeys = [...new Set(keys)];
    this.stats.gets += uniqueKeys.length;

    const results = new Map<string, T | null>();
    const states = new Map(
      uniqueKeys.map((key) => {
        const state = this.retainKeyState(key);
        return [key, { state, generation: state.generation }] as const;
      }),
    );
    try {
      let remainingKeys = [...uniqueKeys];
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
            const expected = states.get(k);
            if (!expected) return;
            backfillPromises.push(
              this.backfill(
                k,
                v,
                ["l1"],
                expected.state,
                expected.generation,
                this.config.l2,
              ),
            );
          },
        );
      }

      if (this.config.l3 && remainingKeys.length > 0) {
        try {
          const l3Results = this.config.l3.getBatch
            ? await this.config.l3.getBatch(remainingKeys)
            : await this.individualGets(this.config.l3, remainingKeys);
          const requestedKeys = new Set(remainingKeys);

          for (const [k, v] of l3Results) {
            if (!requestedKeys.has(k)) continue;
            if (v !== null) {
              results.set(k, v);
              this.stats.l3Hits++;
              const expected = states.get(k);
              if (expected) {
                backfillPromises.push(
                  this.backfill(
                    k,
                    v,
                    ["l1", "l2"],
                    expected.state,
                    expected.generation,
                    this.config.l3,
                  ),
                );
              }
            } else {
              results.set(k, null);
              this.stats.misses++;
            }
          }
        } catch (error) {
          logger.error(`[${this.config.name}] L3 getBatch error`, {
            keyCount: remainingKeys.length,
            errorName: error instanceof Error ? error.name : typeof error,
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
          void Promise.all(backfillPromises).catch((error) => {
            logger.debug(`[${this.config.name}] async batch backfill failed (best-effort)`, {
              promiseCount: backfillPromises.length,
              errorName: error instanceof Error ? error.name : typeof error,
            });
          });
        } else {
          await Promise.all(backfillPromises);
        }
      }

      return results;
    } finally {
      for (const [key, { state }] of states) this.releaseKeyState(key, state);
    }
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

  private retainKeyState(key: string): KeyState {
    let state = this.keyStates.get(key);
    if (!state) {
      state = { generation: 0, activeOperations: 0 };
      this.keyStates.set(key, state);
    }
    state.activeOperations++;
    return state;
  }

  private releaseKeyState(key: string, state: KeyState): void {
    state.activeOperations--;
    if (state.activeOperations < 0) {
      state.activeOperations = 0;
      logger.error(`[${this.config.name}] Invalid cache key-state reference count`, {
        keyLength: key.length,
      });
    }
    this.pruneKeyState(key, state);
  }

  private pruneKeyState(key: string, state = this.keyStates.get(key)): void {
    if (
      state && this.keyStates.get(key) === state && state.activeOperations === 0 &&
      !this.mutationQueues.has(key) && !this.computations.has(key)
    ) {
      this.keyStates.delete(key);
    }
  }

  private advanceGeneration(state: KeyState): number {
    state.generation++;
    return state.generation;
  }

  private isCurrentGeneration(key: string, state: KeyState, generation: number): boolean {
    return this.keyStates.get(key) === state && state.generation === generation;
  }

  /** Serialize all writes for one key so a slow stale write cannot finish last. */
  private enqueueMutation(key: string, mutation: () => Promise<void>): Promise<void> {
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(mutation);
    this.mutationQueues.set(key, queued);
    const cleanup = (): void => {
      if (this.mutationQueues.get(key) === queued) {
        this.mutationQueues.delete(key);
        this.pruneKeyState(key);
      }
    };
    void queued.then(cleanup, cleanup);
    return queued;
  }

  private async writeValue(key: string, value: T, ttl: number): Promise<void> {
    const perPodTiers = [this.config.l1, this.config.l2].filter(
      (tier): tier is CacheTier<T> => tier !== undefined,
    );

    // Commit the distributed tier first. Publishing to L1/L2 before L3
    // acknowledges the value lets one pod observe data that never became
    // authoritative for other pods.
    if (this.config.l3) {
      try {
        await this.config.l3.set(key, value, ttl);
      } catch (error) {
        logger.error(`[${this.config.name}] Set error in ${this.config.l3.name}`, {
          keyLength: key.length,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        throw error;
      }
    } else if (perPodTiers.length === 0) {
      throw CACHE_ERROR.create({
        detail: "Cannot set a value because no cache tiers are configured",
        context: { cacheName: this.config.name },
      });
    }

    await Promise.all(
      perPodTiers.map(async (tier) => {
        try {
          await tier.set(key, value, ttl);
        } catch (error) {
          logger.error(`[${this.config.name}] Set error in ${tier.name}`, {
            keyLength: key.length,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          throw error;
        }
      }),
    );
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

      logger.debug(`[${this.config.name}] ${tierName.toUpperCase()} hit`, {
        keyLength: key.length,
      });
      return value;
    } catch (error) {
      logger.error(`[${this.config.name}] ${tierName.toUpperCase()} get error`, {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
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
      const requestedKeys = new Set(keys);

      for (const [k, v] of tierResults) {
        if (!requestedKeys.has(k)) continue;
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
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return keys;
    }
  }

  private async maybeAwaitBackfill(promise: Promise<void>): Promise<void> {
    if (this.config.asyncBackfill) {
      void promise.catch((error) => {
        logger.debug(`[${this.config.name}] async backfill failed (best-effort)`, {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      });
      return;
    }
    await promise;
  }

  private async backfill(
    key: string,
    value: T,
    tiers: ("l1" | "l2")[],
    expectedState: KeyState,
    generation: number,
    sourceTier?: CacheTier<T>,
  ): Promise<void> {
    const state = this.retainKeyState(key);
    try {
      if (!this.config.backfillOnHit) return;
      if (state !== expectedState || !this.isCurrentGeneration(key, state, generation)) return;

      this.stats.backfills++;

      // Derive the backfill TTL from the source entry's remaining lifetime when the
      // source tier can report it. Writing defaultTtl unconditionally resurrects a
      // near-expired value (e.g. a 5s entry would get a fresh 300s on L1 backfill).
      // Fall back only when the source tier does not implement TTL reporting.
      // Once a tier reports TTLs, an unknown result must fail closed.
      let ttl = this.config.defaultTtlSeconds;
      if (sourceTier?.getRemainingTtlSeconds) {
        let remaining: number | null | undefined;
        try {
          remaining = await sourceTier.getRemainingTtlSeconds(key);
        } catch (error) {
          logger.debug(`[${this.config.name}] remaining-TTL lookup failed; skipping backfill`, {
            errorName: error instanceof Error ? error.name : typeof error,
          });
          return;
        }

        // A TTL-aware source returning null no longer has an authoritative entry.
        // Backfilling the previously read value with a fresh default would revive it.
        if (typeof remaining !== "number" || Number.isNaN(remaining) || remaining <= 0) {
          return;
        }
        ttl = Math.min(remaining, this.config.defaultTtlSeconds);
      }

      if (!this.isCurrentGeneration(key, state, generation)) return;

      await this.enqueueMutation(key, async () => {
        if (!this.isCurrentGeneration(key, state, generation)) return;
        const backfillOps: Promise<void>[] = [];

        if (tiers.includes("l1") && this.config.l1) {
          backfillOps.push(
            this.config.l1.set(key, value, ttl).catch((error) => {
              logger.error(`[${this.config.name}] L1 backfill error`, {
                keyLength: key.length,
                errorName: error instanceof Error ? error.name : typeof error,
              });
            }),
          );
        }

        if (tiers.includes("l2") && this.config.l2) {
          backfillOps.push(
            this.config.l2.set(key, value, ttl).catch((error) => {
              logger.error(`[${this.config.name}] L2 backfill error`, {
                keyLength: key.length,
                errorName: error instanceof Error ? error.name : typeof error,
              });
            }),
          );
        }

        await Promise.all(backfillOps);
      });
    } finally {
      this.releaseKeyState(key, state);
    }
  }

  private async computeAndPublish(
    key: string,
    computeFn: () => Promise<T>,
    ttl: number,
    state: KeyState,
    generation: number,
  ): Promise<T> {
    const value = await computeFn();
    if (this.isCurrentGeneration(key, state, generation)) {
      const publishGeneration = this.advanceGeneration(state);
      this.stats.sets++;
      await this.enqueueMutation(key, async () => {
        if (!this.isCurrentGeneration(key, state, publishGeneration)) return;
        await this.writeValue(key, value, ttl);
      });
    }
    return value;
  }

  private async individualGets(tier: CacheTier<T>, keys: string[]): Promise<Map<string, T | null>> {
    const results = await Promise.all(keys.map(async (key) => [key, await tier.get(key)] as const));
    return new Map(results);
  }
}

function validateConfig<T>(
  config:
    & Required<Omit<MultiTierCacheConfig<T>, "l1" | "l2" | "l3">>
    & Pick<MultiTierCacheConfig<T>, "l1" | "l2" | "l3">,
): void {
  if (
    typeof config.name !== "string" || config.name.length === 0 || config.name.length > 256 ||
    config.name.trim() !== config.name || /\p{Cc}/u.test(config.name)
  ) {
    throw new TypeError(
      "Multi-tier cache name must be a trimmed 1-256 character string without control characters",
    );
  }
  if (
    !Number.isFinite(config.defaultTtlSeconds) || config.defaultTtlSeconds <= 0 ||
    config.defaultTtlSeconds > MAX_CACHE_TTL_SECONDS
  ) {
    throw new RangeError(
      `Multi-tier cache default TTL must be greater than 0 and at most ${MAX_CACHE_TTL_SECONDS} seconds`,
    );
  }
  if (typeof config.backfillOnHit !== "boolean" || typeof config.asyncBackfill !== "boolean") {
    throw new TypeError("Multi-tier cache backfill options must be booleans");
  }
}
