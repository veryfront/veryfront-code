import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";

const DEFAULT_CIRCUIT_OPEN_DURATION_MS = 30_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_MAX_PENDING_MUTATIONS = 1_000;
const MAX_CIRCUIT_OPEN_DURATION_MS = 3_600_000;
const MAX_FAILURE_THRESHOLD = 100;
const MAX_PENDING_MUTATIONS = 100_000;
const MAX_REPLAY_PASSES = 8;

const logger = proxyLogger.child({ module: "cache" });

/** Circuit-breaker and consistency-journal settings for {@link ResilientCache}. */
export interface ResilientCacheOptions {
  /** Delay before one caller may probe an unavailable primary cache. */
  circuitOpenDurationMs?: number;
  /** Number of consecutive read failures that opens the circuit. */
  failureThreshold?: number;
  /** Maximum per-key mutations retained before recovery falls back to a primary clear. */
  maxPendingMutations?: number;
}

interface PendingMutation {
  revision: number;
  kind: "set" | "delete";
  entry?: TokenCacheEntry;
}

function requireIntegerOption(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function safeErrorContext(error: unknown): { errorName: string } {
  return { errorName: error instanceof Error ? error.name : "UnknownError" };
}

function snapshotEntry(entry: TokenCacheEntry): TokenCacheEntry {
  const token = entry.token;
  const expiresAt = entry.expiresAt;
  const scope = entry.scope;
  const projectSlug = entry.projectSlug;
  return {
    token,
    expiresAt,
    scope,
    ...(projectSlug === undefined ? {} : { projectSlug }),
  };
}

/**
 * Uses a primary cache while maintaining a local fallback and a bounded
 * mutation journal that prevents stale primary values from being resurrected.
 */
export class ResilientCache implements TokenCache {
  private readonly primary: TokenCache;
  private readonly fallback: TokenCache;
  private readonly circuitOpenDurationMs: number;
  private readonly failureThreshold: number;
  private readonly maxPendingMutations: number;
  private usingFallback = false;
  private failureCount = 0;
  private circuitOpenedAt: number | null = null;
  private halfOpenProbe: Promise<boolean> | null = null;
  private pendingMutations = new Map<string, PendingMutation>();
  private mutationRevision = 0;
  private requiresPrimaryClear = false;
  private primaryClearRevision = 0;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  /** Create a resilient cache from distinct primary and fallback instances. */
  constructor(
    primary: TokenCache,
    fallback: TokenCache,
    options: ResilientCacheOptions = {},
  ) {
    if (primary === fallback) {
      throw new TypeError("primary and fallback caches must be different instances");
    }
    this.primary = primary;
    this.fallback = fallback;
    this.circuitOpenDurationMs = requireIntegerOption(
      "circuitOpenDurationMs",
      options.circuitOpenDurationMs ?? DEFAULT_CIRCUIT_OPEN_DURATION_MS,
      0,
      MAX_CIRCUIT_OPEN_DURATION_MS,
    );
    this.failureThreshold = requireIntegerOption(
      "failureThreshold",
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      1,
      MAX_FAILURE_THRESHOLD,
    );
    this.maxPendingMutations = requireIntegerOption(
      "maxPendingMutations",
      options.maxPendingMutations ?? DEFAULT_MAX_PENDING_MUTATIONS,
      1,
      MAX_PENDING_MUTATIONS,
    );
  }

  /** Reject operations after lifecycle shutdown. */
  private assertOpen(): void {
    if (this.closed) throw new Error("ResilientCache is closed");
  }

  /** Reset failure state when no newer operation has opened the circuit. */
  private recordSuccess(completeRecovery = false): boolean {
    if (this.usingFallback && !completeRecovery) return false;
    const recovered = this.usingFallback;
    this.failureCount = 0;
    this.usingFallback = false;
    this.circuitOpenedAt = null;
    if (recovered) {
      logger.debug("[ResilientCache] Primary recovered, switching back from fallback");
    }
    return true;
  }

  /** Record a primary failure and open the circuit when required. */
  private recordFailure(error: unknown, openImmediately = false): void {
    this.failureCount = Math.min(this.failureCount + 1, this.failureThreshold);
    logger.warn(
      `[ResilientCache] Primary cache operation failed (${this.failureCount}/${this.failureThreshold})`,
      safeErrorContext(error),
    );

    if (this.usingFallback) {
      this.circuitOpenedAt = Date.now();
      return;
    }
    if (!openImmediately && this.failureCount < this.failureThreshold) return;

    logger.warn("[ResilientCache] Opening circuit, switching to fallback cache");
    this.usingFallback = true;
    this.circuitOpenedAt = Date.now();
  }

  /** Coalesce one unavailable-primary mutation into the bounded journal. */
  private queueMutation(
    key: string,
    kind: PendingMutation["kind"],
    entry?: TokenCacheEntry,
  ): void {
    const revision = ++this.mutationRevision;
    if (!this.pendingMutations.has(key) && this.pendingMutations.size >= this.maxPendingMutations) {
      // Clearing the primary is the safe bounded fallback: it may lose remote
      // cache hits, but it cannot resurrect a token deleted during the outage.
      this.pendingMutations.clear();
      this.requiresPrimaryClear = true;
      this.primaryClearRevision = revision;
    }
    this.pendingMutations.set(key, {
      revision,
      kind,
      ...(entry === undefined ? {} : { entry: { ...entry } }),
    });
  }

  /** Replace pending per-key mutations with a full-primary clear. */
  private queueClear(): void {
    this.pendingMutations.clear();
    this.requiresPrimaryClear = true;
    this.primaryClearRevision = ++this.mutationRevision;
  }

  /** Replay a stable journal snapshot before primary reads resume. */
  private async replayPendingMutations(): Promise<boolean> {
    let performedPrimaryOperation = false;

    for (let pass = 0; pass < MAX_REPLAY_PASSES; pass++) {
      if (this.requiresPrimaryClear) {
        const clearRevision = this.primaryClearRevision;
        await this.primary.clear();
        performedPrimaryOperation = true;
        if (this.requiresPrimaryClear && this.primaryClearRevision === clearRevision) {
          this.requiresPrimaryClear = false;
        }
        // A newer clear supersedes this completed one. Apply that clear before
        // replaying any mutations that were queued after it.
        if (this.requiresPrimaryClear) continue;
      }

      const mutations = [...this.pendingMutations.entries()].sort(
        ([, left], [, right]) => left.revision - right.revision,
      );
      for (const [key, mutation] of mutations) {
        if (mutation.kind === "set") {
          if (!mutation.entry) throw new Error("Invalid pending cache mutation");
          await this.primary.set(key, mutation.entry);
        } else {
          await this.primary.delete(key);
        }
        performedPrimaryOperation = true;

        if (this.pendingMutations.get(key)?.revision === mutation.revision) {
          this.pendingMutations.delete(key);
        }
      }

      if (!this.requiresPrimaryClear && this.pendingMutations.size === 0) {
        if (!performedPrimaryOperation) {
          await this.primary.stats();
          performedPrimaryOperation = true;
          // A mutation may have arrived while the asynchronous probe was in
          // progress. Recheck the journal before closing the circuit.
          continue;
        }
        this.recordSuccess(true);
        return true;
      }
    }

    this.circuitOpenedAt = Date.now();
    logger.warn("[ResilientCache] Primary recovery deferred while cache mutations continue");
    return false;
  }

  /** Probe and synchronize the primary cache for one half-open caller. */
  private async runHalfOpenProbe(): Promise<boolean> {
    logger.debug("[ResilientCache] Circuit half-open, probing primary cache");
    try {
      const recovered = await this.replayPendingMutations();
      if (!recovered) return false;
      return true;
    } catch (error) {
      this.recordFailure(error);
      return false;
    }
  }

  /** Return whether this operation may use the primary cache. */
  private async canUsePrimary(): Promise<boolean> {
    if (!this.usingFallback) return true;
    const openedAt = this.circuitOpenedAt;
    if (openedAt === null || Date.now() - openedAt < this.circuitOpenDurationMs) return false;

    // Concurrent callers use the fallback instead of joining the probe and
    // creating a latency spike or a primary-cache thundering herd.
    if (this.halfOpenProbe) return false;
    const probe = this.runHalfOpenProbe();
    this.halfOpenProbe = probe;
    try {
      return await probe;
    } finally {
      if (this.halfOpenProbe === probe) this.halfOpenProbe = null;
    }
  }

  /** Read from the primary when consistent, otherwise from the fallback. */
  async get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(
      "cache.resilient.get",
      async () => {
        this.assertOpen();
        if (await this.canUsePrimary()) {
          let result: TokenCacheEntry | null;
          try {
            result = await this.primary.get(key);
            if (!this.recordSuccess()) return this.fallback.get(key);
          } catch (error) {
            this.recordFailure(error);
            return this.fallback.get(key);
          }
          if (result !== null) return result;
        }
        return this.fallback.get(key);
      },
      { "cache.usingFallback": this.usingFallback },
    );
  }

  /** Write the fallback first and preserve failed primary writes for replay. */
  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      "cache.resilient.set",
      async () => {
        this.assertOpen();
        const ownedEntry = snapshotEntry(entry);
        await this.fallback.set(key, ownedEntry);

        if (this.usingFallback) {
          this.queueMutation(key, "set", ownedEntry);
          await this.canUsePrimary();
          return;
        }

        try {
          await this.primary.set(key, ownedEntry);
          if (!this.recordSuccess()) this.queueMutation(key, "set", ownedEntry);
        } catch (error) {
          this.queueMutation(key, "set", ownedEntry);
          this.recordFailure(error, true);
        }
      },
      { "cache.usingFallback": this.usingFallback },
    );
  }

  /** Delete locally and preserve failed primary deletes for replay. */
  async delete(key: string): Promise<void> {
    return withSpan("cache.resilient.delete", async () => {
      this.assertOpen();
      await this.fallback.delete(key);

      if (this.usingFallback) {
        this.queueMutation(key, "delete");
        await this.canUsePrimary();
        return;
      }

      try {
        await this.primary.delete(key);
        if (!this.recordSuccess()) this.queueMutation(key, "delete");
      } catch (error) {
        this.queueMutation(key, "delete");
        this.recordFailure(error, true);
      }
    });
  }

  /** Clear locally and preserve a failed primary clear for replay. */
  async clear(): Promise<void> {
    return withSpan("cache.resilient.clear", async () => {
      this.assertOpen();
      await this.fallback.clear();

      if (this.usingFallback) {
        this.queueClear();
        await this.canUsePrimary();
        return;
      }

      try {
        await this.primary.clear();
        if (!this.recordSuccess()) this.queueClear();
      } catch (error) {
        this.queueClear();
        this.recordFailure(error, true);
      }
    });
  }

  /** Check the primary when consistent and consult the fallback on a miss. */
  async has(key: string): Promise<boolean> {
    return withSpan("cache.resilient.has", async () => {
      this.assertOpen();
      if (await this.canUsePrimary()) {
        let result: boolean;
        try {
          result = await this.primary.has(key);
          if (!this.recordSuccess()) return this.fallback.has(key);
        } catch (error) {
          this.recordFailure(error);
          return this.fallback.has(key);
        }
        if (result) return true;
      }
      return this.fallback.has(key);
    });
  }

  /** Return statistics from the active cache tier. */
  async stats(): Promise<CacheStats> {
    return withSpan(
      "cache.resilient.stats",
      async () => {
        this.assertOpen();
        if (await this.canUsePrimary()) {
          try {
            const stats = await this.primary.stats();
            if (!this.recordSuccess()) return this.fallback.stats();
            return stats;
          } catch (error) {
            this.recordFailure(error);
          }
        }
        return this.fallback.stats();
      },
      { "cache.usingFallback": this.usingFallback },
    );
  }

  /** Close both cache tiers exactly once. */
  close(): Promise<void> {
    return withSpan("cache.resilient.close", async () => {
      if (this.closePromise) return this.closePromise;
      this.closed = true;
      this.closePromise = this.closeCaches();
      return this.closePromise;
    });
  }

  /** Wait for recovery and release both cache tiers. */
  private async closeCaches(): Promise<void> {
    if (this.halfOpenProbe) await this.halfOpenProbe;
    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.primary.close()),
      Promise.resolve().then(() => this.fallback.close()),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length > 0) {
      logger.warn("[ResilientCache] One or more caches failed to close", {
        failureCount: failures.length,
      });
      throw new Error("Failed to close one or more token caches");
    }
  }

  /** Return a snapshot of the circuit-breaker state. */
  getStatus(): {
    usingFallback: boolean;
    failureCount: number;
    circuitOpenedAt: number | null;
  } {
    return {
      usingFallback: this.usingFallback,
      failureCount: this.failureCount,
      circuitOpenedAt: this.circuitOpenedAt,
    };
  }
}
