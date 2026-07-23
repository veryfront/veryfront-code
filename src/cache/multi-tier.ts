/**
 * Multi-Tier Cache Abstraction
 *
 * Generic implementation for L1 → L2 → L3 cache flows with automatic backfill.
 * This provides consistent caching behavior across the codebase:
 *
 * - L1: In-memory (fastest, per-pod, lost on restart)
 * - L2: Local disk (fast, per-pod, survives restart)
 * - L3: Shared backend (Redis, API, or disk)
 *
 * When a cache hit occurs at a lower tier (e.g., L3), the value is automatically
 * backfilled to higher tiers (L1, L2) for faster subsequent access.
 *
 * @module cache/multi-tier
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CACHE_ERROR, INVALID_ARGUMENT, SERVICE_OVERLOADED } from "#veryfront/errors";
import { containsUnsafeCacheStringCharacter } from "./validation.ts";

const MAX_CACHE_NAME_LENGTH = 128;
const MAX_CACHE_KEY_LENGTH = 4096;
const MAX_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_CACHE_BATCH_ENTRIES = 1000;
const MAX_INFLIGHT_COMPUTATIONS = 1000;
const MAX_INFLIGHT_MUTATION_KEYS = 1000;
const MAX_INFLIGHT_MUTATIONS = 1000;
const MAX_INFLIGHT_BACKFILLS = 1000;
const MAX_ACTIVE_OBSERVATION_KEYS = 10_000;

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    containsUnsafeCacheStringCharacter(value)
  ) {
    invalidArgument(
      `${label} must be a bounded string without control characters or unpaired UTF-16 surrogates`,
    );
  }
}

function assertCacheKey(key: unknown): asserts key is string {
  assertBoundedString(key, "Cache key", MAX_CACHE_KEY_LENGTH);
}

function normalizeTtl(value: unknown, label: string): number {
  if (
    typeof value !== "number" || !Number.isFinite(value) || value <= 0 ||
    value > MAX_CACHE_TTL_SECONDS
  ) {
    invalidArgument(`${label} must be a positive finite number within the supported range`);
  }
  return value;
}

function readProperty(value: object, key: string, label: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    invalidArgument(`${label} must be readable`);
  }
}

function normalizeTier<T>(value: unknown, role: string): CacheTier<T> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidArgument(`${role} cache tier must be an object`);
  }
  const tier = value as object;
  const name = readProperty(tier, "name", `${role} cache tier`);
  const get = readProperty(tier, "get", `${role} cache tier`);
  const set = readProperty(tier, "set", `${role} cache tier`);
  const getRemainingTtlSeconds = readProperty(
    tier,
    "getRemainingTtlSeconds",
    `${role} cache tier`,
  );
  const deleteEntry = readProperty(tier, "delete", `${role} cache tier`);
  const has = readProperty(tier, "has", `${role} cache tier`);
  const getBatch = readProperty(tier, "getBatch", `${role} cache tier`);
  const setBatch = readProperty(tier, "setBatch", `${role} cache tier`);

  assertBoundedString(name, `${role} cache tier name`, MAX_CACHE_NAME_LENGTH);
  if (typeof get !== "function" || typeof set !== "function") {
    invalidArgument(`${role} cache tier must provide get and set functions`);
  }
  for (
    const [methodName, method] of [
      ["getRemainingTtlSeconds", getRemainingTtlSeconds],
      ["delete", deleteEntry],
      ["has", has],
      ["getBatch", getBatch],
      ["setBatch", setBatch],
    ] as const
  ) {
    if (method !== undefined && typeof method !== "function") {
      invalidArgument(`${role} cache tier ${methodName} must be a function`);
    }
  }
  const ttlFunction = typeof getRemainingTtlSeconds === "function"
    ? getRemainingTtlSeconds
    : undefined;
  const deleteFunction = typeof deleteEntry === "function" ? deleteEntry : undefined;
  const hasFunction = typeof has === "function" ? has : undefined;
  const getBatchFunction = typeof getBatch === "function" ? getBatch : undefined;
  const setBatchFunction = typeof setBatch === "function" ? setBatch : undefined;

  return Object.freeze({
    name,
    get: (key: string) => get.call(tier, key) as Promise<T | null>,
    set: (key: string, entry: T, ttl?: number) => set.call(tier, key, entry, ttl) as Promise<void>,
    getRemainingTtlSeconds: ttlFunction === undefined
      ? undefined
      : (key: string) => ttlFunction.call(tier, key) as Promise<number | null>,
    delete: deleteFunction === undefined
      ? undefined
      : (key: string) => deleteFunction.call(tier, key) as Promise<void>,
    has: hasFunction === undefined
      ? undefined
      : (key: string) => hasFunction.call(tier, key) as Promise<boolean>,
    getBatch: getBatchFunction === undefined
      ? undefined
      : (keys: string[]) => getBatchFunction.call(tier, keys) as Promise<Map<string, T | null>>,
    setBatch: setBatchFunction === undefined
      ? undefined
      : (entries: Array<{ key: string; value: T; ttl?: number }>) =>
        setBatchFunction.call(tier, entries) as Promise<void>,
  });
}

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
interface MultiTierCacheConfig<T = string> {
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

  /** Backfill operations skipped because the cache reached its capacity */
  droppedBackfills: number;
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
    droppedBackfills: 0,
  };
  private readonly mutationTokens = new Map<string, symbol>();
  private readonly activeObservationCounts = new Map<string, number>();
  private readonly inflightComputations = new Map<
    string,
    { mutationToken: symbol | undefined; promise: Promise<T> }
  >();
  private readonly activeComputations = new Set<Promise<T>>();
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private pendingMutationCount = 0;
  private activeBackfillCount = 0;

  constructor(config: MultiTierCacheConfig<T>) {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      invalidArgument("Multi-tier cache configuration must be an object");
    }
    const configObject = config as object;
    const name = readProperty(configObject, "name", "Multi-tier cache configuration");
    assertBoundedString(name, "Cache name", MAX_CACHE_NAME_LENGTH);
    const defaultTtlSeconds = normalizeTtl(
      readProperty(configObject, "defaultTtlSeconds", "Multi-tier cache configuration") ?? 300,
      "Default cache TTL",
    );
    const backfillOnHit = readProperty(
      configObject,
      "backfillOnHit",
      "Multi-tier cache configuration",
    ) ?? true;
    const asyncBackfill = readProperty(
      configObject,
      "asyncBackfill",
      "Multi-tier cache configuration",
    ) ?? true;
    if (typeof backfillOnHit !== "boolean" || typeof asyncBackfill !== "boolean") {
      invalidArgument("Multi-tier cache backfill options must be booleans");
    }
    this.config = {
      name,
      defaultTtlSeconds,
      backfillOnHit,
      asyncBackfill,
      l1: normalizeTier<T>(
        readProperty(configObject, "l1", "Multi-tier cache configuration"),
        "L1",
      ),
      l2: normalizeTier<T>(
        readProperty(configObject, "l2", "Multi-tier cache configuration"),
        "L2",
      ),
      l3: normalizeTier<T>(
        readProperty(configObject, "l3", "Multi-tier cache configuration"),
        "L3",
      ),
    };
  }

  get(key: string): Promise<T | null> {
    assertCacheKey(key);
    return this.withKeyObservation(
      key,
      (observedMutationToken) =>
        withSpan(
          SpanNames.CACHE_MULTI_TIER_GET,
          async (span?: Span): Promise<T | null> => {
            this.stats.gets++;
            const l1Value = await this.getFromTier(this.config.l1, key, "l1");
            if (l1Value !== null) return l1Value;

            const l2Value = await this.getFromTier(this.config.l2, key, "l2");
            if (l2Value !== null) {
              await this.maybeAwaitBackfill(
                this.backfill(
                  key,
                  l2Value,
                  ["l1"],
                  observedMutationToken,
                  this.config.l2,
                ),
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
                  observedMutationToken,
                  this.config.l3,
                ),
              );
              return l3Value;
            }

            this.stats.misses++;
            span?.setAttribute("cache.hit_tier", "miss");
            return null;
          },
          { "cache.operation": "get" },
        ),
    );
  }

  set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    assertCacheKey(key);
    const ttl = normalizeTtl(ttlSeconds ?? this.config.defaultTtlSeconds, "Cache TTL");
    return this.enqueueExplicitMutation(key, () =>
      withSpan(
        SpanNames.CACHE_MULTI_TIER_SET,
        async (span?: Span): Promise<void> => {
          this.stats.sets++;
          span?.setAttribute("cache.ttl_seconds", ttl);

          // L3 is authoritative. Publish to per-pod tiers only after it accepts
          // the write so a failed distributed write cannot leave a local value
          // that other pods will never observe.
          const perPodTiers = [this.config.l1, this.config.l2].filter(
            (t): t is CacheTier<T> => t !== undefined,
          );

          if (this.config.l3) {
            try {
              await this.config.l3.set(key, value, ttl);
            } catch (error) {
              logger.error("Authoritative cache write failed", {
                errorName: error instanceof Error ? error.name : typeof error,
              });
              throw error;
            }
          }

          const perPodResults = await Promise.allSettled(
            perPodTiers.map((tier) => tier.set(key, value, ttl)),
          );
          const failedPerPodTiers = perPodResults.filter((result) =>
            result.status === "rejected"
          ).length;
          if (failedPerPodTiers > 0) {
            logger.error("Per-pod cache write failed", {
              failedTierCount: failedPerPodTiers,
            });
            throw CACHE_ERROR.create({
              detail: "One or more per-pod cache writes failed",
              context: { failedTierCount: failedPerPodTiers },
            });
          }
        },
        { "cache.operation": "set" },
      ));
  }

  delete(key: string): Promise<void> {
    assertCacheKey(key);
    return this.enqueueExplicitMutation(key, async () => {
      const configuredPerPodTiers: Array<["l1" | "l2", CacheTier<T>]> = [];
      if (this.config.l1) configuredPerPodTiers.push(["l1", this.config.l1]);
      if (this.config.l2) configuredPerPodTiers.push(["l2", this.config.l2]);
      const configuredTiers: Array<["l1" | "l2" | "l3", CacheTier<T>]> = [
        ...configuredPerPodTiers,
      ];
      if (this.config.l3) configuredTiers.push(["l3", this.config.l3]);
      const missingDeleteTiers = configuredTiers
        .filter(([, tier]) => tier.delete === undefined)
        .map(([role]) => role);
      if (missingDeleteTiers.length > 0) {
        throw CACHE_ERROR.create({
          detail: `Delete failed in cache tier(s): ${missingDeleteTiers.join(", ")}`,
          context: { failedTiers: missingDeleteTiers },
        });
      }

      // L3 is authoritative. Do not clear per-pod tiers if the distributed
      // invalidation was rejected, because a subsequent miss would immediately
      // repopulate them from the still-live authoritative entry.
      if (this.config.l3) {
        try {
          await this.config.l3.delete!(key);
        } catch (error) {
          logger.error("Authoritative cache delete failed", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
          throw CACHE_ERROR.create({
            detail: "Delete failed in cache tier(s): l3",
            context: { failedTiers: ["l3"] },
          });
        }
      }

      const perPodResults = await Promise.allSettled(
        configuredPerPodTiers.map(([, tier]) => tier.delete!(key)),
      );
      const failedPerPodTiers = configuredPerPodTiers
        .filter((_, index) => perPodResults[index]?.status === "rejected")
        .map(([role]) => role);
      if (failedPerPodTiers.length > 0) {
        logger.error("Per-pod cache delete failed", {
          failedTierCount: failedPerPodTiers.length,
        });
        throw CACHE_ERROR.create({
          detail: `Delete failed in cache tier(s): ${failedPerPodTiers.join(", ")}`,
          context: { failedTiers: failedPerPodTiers },
        });
      }
    });
  }

  async getOrCompute(key: string, computeFn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    assertCacheKey(key);
    if (typeof computeFn !== "function") {
      invalidArgument("Cache compute callback must be a function");
    }
    if (ttlSeconds !== undefined) normalizeTtl(ttlSeconds, "Cache TTL");
    return await this.withKeyObservation(key, async (observedMutationToken) => {
      const cached = await this.get(key);
      if (cached !== null) return cached;

      const existing = this.inflightComputations.get(key);
      if (existing && existing.mutationToken === observedMutationToken) return existing.promise;
      if (this.activeComputations.size >= MAX_INFLIGHT_COMPUTATIONS) {
        throw SERVICE_OVERLOADED.create({ message: "Cache computation capacity exceeded" });
      }

      const computation = (async () => {
        const value = await computeFn();
        if (observedMutationToken === this.mutationTokens.get(key)) {
          await this.set(key, value, ttlSeconds);
        }
        return value;
      })();
      const record = { mutationToken: observedMutationToken, promise: computation };
      this.inflightComputations.set(key, record);
      this.activeComputations.add(computation);
      try {
        return await computation;
      } finally {
        this.activeComputations.delete(computation);
        if (this.inflightComputations.get(key) === record) {
          this.inflightComputations.delete(key);
        }
      }
    });
  }

  async getBatch(keys: string[]): Promise<Map<string, T | null>> {
    if (!Array.isArray(keys) || keys.length > MAX_CACHE_BATCH_ENTRIES) {
      invalidArgument("Cache batch exceeds the supported entry count");
    }
    for (const key of keys) assertCacheKey(key);
    if (keys.length === 0) return new Map();
    return await this.withKeyObservations(
      keys,
      (observedMutationTokens) => this.getBatchObserved(keys, observedMutationTokens),
    );
  }

  private async getBatchObserved(
    keys: string[],
    observedMutationTokens: ReadonlyMap<string, symbol | undefined>,
  ): Promise<Map<string, T | null>> {
    this.stats.gets += keys.length;

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
          backfillPromises.push(
            this.backfill(k, v, ["l1"], observedMutationTokens.get(k), this.config.l2),
          );
        },
      );
    }

    if (this.config.l3 && remainingKeys.length > 0) {
      try {
        const l3Results = this.config.l3.getBatch
          ? await this.config.l3.getBatch(remainingKeys)
          : await this.individualGets(this.config.l3, remainingKeys);

        for (const k of remainingKeys) {
          const v = l3Results.get(k) ?? null;
          if (v !== null) {
            results.set(k, v);
            this.stats.l3Hits++;
            backfillPromises.push(
              this.backfill(
                k,
                v,
                ["l1", "l2"],
                observedMutationTokens.get(k),
                this.config.l3,
              ),
            );
          } else {
            results.set(k, null);
            this.stats.misses++;
          }
        }
      } catch (error) {
        logger.error("L3 cache batch read failed", {
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
          logger.debug("Async batch cache backfill failed", {
            promiseCount: backfillPromises.length,
            errorName: error instanceof Error ? error.name : typeof error,
          });
        });
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
      droppedBackfills: 0,
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

      logger.debug("Cache tier hit", { tier: tierName });
      return value;
    } catch (error) {
      logger.error("Cache tier read failed", {
        tier: tierName,
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
      if (!(tierResults instanceof Map)) {
        throw new TypeError("Cache tier returned an invalid batch");
      }

      for (const k of keys) {
        const v = tierResults.get(k) ?? null;
        if (v === null) continue;

        results.set(k, v);
        if (tierName === "l1") this.stats.l1Hits++;
        if (tierName === "l2") this.stats.l2Hits++;
        onHit?.(k, v);
      }

      return keys.filter((k) => !results.has(k) || results.get(k) === null);
    } catch (error) {
      logger.error("Cache tier batch read failed", {
        tier: tierName,
        keyCount: keys.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return keys;
    }
  }

  private async maybeAwaitBackfill(promise: Promise<void>): Promise<void> {
    if (this.config.asyncBackfill) {
      void promise.catch((error) => {
        logger.debug("Async cache backfill failed", {
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
    observedMutationToken: symbol | undefined,
    sourceTier?: CacheTier<T>,
  ): Promise<void> {
    return await this.withKeyObservation(key, async () => {
      if (!this.config.backfillOnHit) return;

      if (this.activeBackfillCount >= MAX_INFLIGHT_BACKFILLS) {
        this.stats.droppedBackfills++;
        return;
      }
      this.activeBackfillCount++;
      this.stats.backfills++;

      try {
        await this.performBackfill(
          key,
          value,
          tiers,
          observedMutationToken,
          sourceTier,
        );
      } finally {
        this.activeBackfillCount--;
      }
    });
  }

  private async performBackfill(
    key: string,
    value: T,
    tiers: ("l1" | "l2")[],
    observedMutationToken: symbol | undefined,
    sourceTier?: CacheTier<T>,
  ): Promise<void> {
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
        logger.debug("Remaining-TTL lookup failed; skipping backfill", {
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

    if (observedMutationToken !== this.mutationTokens.get(key)) return;

    await this.enqueueMutation(key, async () => {
      // Re-check after waiting behind any same-key mutation. If a newer write or
      // delete was accepted while the lower-tier read was in flight, its value
      // must win over this older observation.
      if (observedMutationToken !== this.mutationTokens.get(key)) return;

      const backfillOps: Promise<void>[] = [];

      if (tiers.includes("l1") && this.config.l1) {
        backfillOps.push(
          this.config.l1.set(key, value, ttl).catch((error) => {
            logger.error("L1 cache backfill failed", {
              errorName: error instanceof Error ? error.name : typeof error,
            });
          }),
        );
      }

      if (tiers.includes("l2") && this.config.l2) {
        backfillOps.push(
          this.config.l2.set(key, value, ttl).catch((error) => {
            logger.error("L2 cache backfill failed", {
              errorName: error instanceof Error ? error.name : typeof error,
            });
          }),
        );
      }

      await Promise.all(backfillOps);
    }, true);
  }

  private async individualGets(tier: CacheTier<T>, keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();
    for (const key of keys) {
      results.set(key, await tier.get(key));
    }
    return results;
  }

  private beginObservation(key: string): symbol | undefined {
    const currentCount = this.activeObservationCounts.get(key);
    if (currentCount === undefined) {
      if (this.activeObservationCounts.size >= MAX_ACTIVE_OBSERVATION_KEYS) {
        throw SERVICE_OVERLOADED.create({ message: "Cache observation capacity exceeded" });
      }
      this.activeObservationCounts.set(key, 1);
    } else {
      this.activeObservationCounts.set(key, currentCount + 1);
    }
    return this.mutationTokens.get(key);
  }

  private endObservation(key: string): void {
    const currentCount = this.activeObservationCounts.get(key);
    if (currentCount === undefined) return;
    if (currentCount === 1) {
      this.activeObservationCounts.delete(key);
    } else {
      this.activeObservationCounts.set(key, currentCount - 1);
    }
    this.pruneMutationToken(key);
  }

  private async withKeyObservation<R>(
    key: string,
    operation: (observedMutationToken: symbol | undefined) => Promise<R>,
  ): Promise<R> {
    const observedMutationToken = this.beginObservation(key);
    try {
      return await operation(observedMutationToken);
    } finally {
      this.endObservation(key);
    }
  }

  private async withKeyObservations<R>(
    keys: Iterable<string>,
    operation: (
      observedMutationTokens: ReadonlyMap<string, symbol | undefined>,
    ) => Promise<R>,
  ): Promise<R> {
    const observedMutationTokens = new Map<string, symbol | undefined>();
    const acquiredKeys: string[] = [];
    try {
      for (const key of new Set(keys)) {
        observedMutationTokens.set(key, this.beginObservation(key));
        acquiredKeys.push(key);
      }
      return await operation(observedMutationTokens);
    } finally {
      for (const key of acquiredKeys) this.endObservation(key);
    }
  }

  private pruneMutationToken(key: string): void {
    if (!this.activeObservationCounts.has(key) && !this.mutationQueues.has(key)) {
      this.mutationTokens.delete(key);
    }
  }

  private enqueueExplicitMutation(
    key: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previousToken = this.mutationTokens.get(key);
    const mutationToken = Symbol();
    this.mutationTokens.set(key, mutationToken);
    try {
      return this.enqueueMutation(key, operation);
    } catch (error) {
      if (this.mutationTokens.get(key) === mutationToken) {
        if (previousToken === undefined) {
          this.mutationTokens.delete(key);
        } else {
          this.mutationTokens.set(key, previousToken);
        }
      }
      throw error;
    }
  }

  private enqueueMutation(
    key: string,
    operation: () => Promise<void>,
    bestEffort = false,
  ): Promise<void> {
    const previous = this.mutationQueues.get(key);
    if (
      this.pendingMutationCount >= MAX_INFLIGHT_MUTATIONS ||
      (!previous && this.mutationQueues.size >= MAX_INFLIGHT_MUTATION_KEYS)
    ) {
      if (bestEffort) {
        this.stats.droppedBackfills++;
        return Promise.resolve();
      }
      throw SERVICE_OVERLOADED.create({ message: "Cache mutation capacity exceeded" });
    }

    this.pendingMutationCount++;
    const queued = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    const tracked = queued.finally(() => {
      this.pendingMutationCount--;
      if (this.mutationQueues.get(key) === tracked) this.mutationQueues.delete(key);
      this.pruneMutationToken(key);
    });
    this.mutationQueues.set(key, tracked);
    return tracked;
  }
}
