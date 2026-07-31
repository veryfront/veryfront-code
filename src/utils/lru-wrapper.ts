import { LRUCacheAdapter } from "./cache/stores/memory/lru-cache-adapter.ts";
import type { LRUCacheOptions } from "./cache/stores/memory/types.ts";
import { DEFAULT_LRU_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { normalizeTimerDurationMs } from "./timer.ts";

/** Default interval between expired-entry cleanup sweeps (1 minute) */
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

interface LRUOptions<K, V> {
  maxEntries?: number;
  /** Byte cap for stored values. Defaults to the adapter's 50 MiB limit. */
  maxSizeBytes?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
  /** Called whenever an entry leaves the cache, including delete/clear/expiry. */
  onEvict?: (key: K, value: V) => void;
  estimateSizeOf?: (value: V) => number;
  now?: () => number;
}

function requirePositiveFinite(value: number, option: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${option} must be a positive finite number`);
  }
  return value;
}

function requirePositiveTimerDuration(value: number, option: string): number {
  const normalized = normalizeTimerDurationMs(value, option);
  if (normalized === 0) {
    throw new RangeError(`${option} must be greater than 0`);
  }
  return normalized;
}

export class LRUCache<K, V> {
  private adapter: LRUCacheAdapter;
  private readonly internalKeys = new Map<K, string>();
  private readonly originalKeys = new Map<string, K>();
  private nextInternalKey = 0;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupIntervalMs: number;
  private ttlMs?: number;

  constructor(options: LRUOptions<K, V> = {}) {
    const ttlMs = options.ttlMs === undefined
      ? undefined
      : requirePositiveFinite(options.ttlMs, "ttlMs");
    const cleanupIntervalMs = requirePositiveTimerDuration(
      options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
      "cleanupIntervalMs",
    );
    const adapterOptions: LRUCacheOptions = {
      maxEntries: options.maxEntries ?? DEFAULT_LRU_MAX_ENTRIES,
      maxSizeBytes: options.maxSizeBytes,
      ttlMs,
      estimateSizeOf: options.estimateSizeOf as
        | ((value: unknown) => number)
        | undefined,
      now: options.now,
      onEvict: (internalKey, value) => {
        const hasOriginalKey = this.originalKeys.has(internalKey);
        const originalKey = hasOriginalKey ? this.originalKeys.get(internalKey) as K : undefined;
        // Release the wrapper identity before notifying observers so a thrown
        // callback cannot strand it and observers always see an evicted key
        // as absent.
        this.releaseInternalKey(internalKey);
        if (hasOriginalKey) options.onEvict?.(originalKey as K, value as V);
      },
    };

    this.adapter = new LRUCacheAdapter(adapterOptions);
    this.ttlMs = ttlMs;
    this.cleanupIntervalMs = cleanupIntervalMs;

    if (this.ttlMs && this.ttlMs > 0) {
      this.startPeriodicCleanup();
    }
  }

  private startPeriodicCleanup(): void {
    if (shouldDisableInterval()) return;
    this.stopCleanupTimer();

    this.cleanupTimer = setInterval(() => {
      this.adapter.cleanupExpired();
    }, this.cleanupIntervalMs);

    // Unref the timer so it doesn't prevent process exit or cause test leaks
    unrefTimer(this.cleanupTimer);
  }

  private stopCleanupTimer(): void {
    if (!this.cleanupTimer) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  private getOrCreateInternalKey(key: K): { internalKey: string; created: boolean } {
    const existing = this.internalKeys.get(key);
    if (existing !== undefined) return { internalKey: existing, created: false };

    const internalKey = `lru:${this.nextInternalKey++}`;
    this.internalKeys.set(key, internalKey);
    this.originalKeys.set(internalKey, key);
    return { internalKey, created: true };
  }

  private releaseInternalKey(internalKey: string): void {
    if (!this.originalKeys.has(internalKey)) return;
    const key = this.originalKeys.get(internalKey) as K;
    this.originalKeys.delete(internalKey);
    this.internalKeys.delete(key);
  }

  get size(): number {
    return this.adapter.getStats().entries;
  }

  has(key: K): boolean {
    const internalKey = this.internalKeys.get(key);
    return internalKey !== undefined && this.adapter.has(internalKey);
  }

  get(key: K): V | undefined {
    const internalKey = this.internalKeys.get(key);
    return internalKey === undefined ? undefined : this.adapter.get<V>(internalKey);
  }

  estimateSize(value: V): number {
    return this.adapter.estimateSize(value);
  }

  set(key: K, value: V, precomputedSize?: number): void {
    const { internalKey, created } = this.getOrCreateInternalKey(key);
    try {
      this.adapter.set(internalKey, value, undefined, undefined, precomputedSize);
    } catch (error) {
      if (created) this.releaseInternalKey(internalKey);
      throw error;
    }
  }

  /**
   * Set one value after atomically preparing it, evicting the selected keys
   * only after sizing and validation have succeeded.
   */
  setWithEvictions(
    key: K,
    value: V,
    keysToEvict: readonly K[],
    precomputedSize: number,
  ): void {
    const { internalKey, created } = this.getOrCreateInternalKey(key);
    const internalKeysToEvict: string[] = [];
    for (const keyToEvict of keysToEvict) {
      const candidate = this.internalKeys.get(keyToEvict);
      if (candidate !== undefined) internalKeysToEvict.push(candidate);
    }

    try {
      this.adapter.setWithEvictions(
        internalKey,
        value,
        internalKeysToEvict,
        precomputedSize,
      );
    } catch (error) {
      if (created) this.releaseInternalKey(internalKey);
      throw error;
    }
  }

  delete(key: K): boolean {
    const internalKey = this.internalKeys.get(key);
    if (internalKey === undefined) return false;

    const had = this.adapter.has(internalKey);
    if (had) this.adapter.delete(internalKey);
    else this.releaseInternalKey(internalKey);
    return had;
  }

  clear(): void {
    this.adapter.clear();
    this.internalKeys.clear();
    this.originalKeys.clear();
  }

  cleanup(): void {
    this.adapter.cleanupExpired();
  }

  destroy(): void {
    this.stopCleanupTimer();
    this.clear();
  }

  *keys(): IterableIterator<K> {
    for (const [internalKey] of this.adapter.entries<unknown>()) {
      if (this.originalKeys.has(internalKey)) {
        yield this.originalKeys.get(internalKey) as K;
      }
    }
  }

  /**
   * Iterate every physically resident key, including entries whose TTL has
   * elapsed but whose lazy or periodic cleanup has not run yet.
   *
   * Invalidation barriers use this view so a clock sample changing at the TTL
   * boundary cannot hide a resident entry from deletion.
   */
  *residentKeys(): IterableIterator<K> {
    yield* this.internalKeys.keys();
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [internalKey, value] of this.adapter.entries<V>()) {
      if (this.originalKeys.has(internalKey)) {
        yield [this.originalKeys.get(internalKey) as K, value];
      }
    }
  }
}

function shouldDisableInterval(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) {
    return true;
  }

  // Read env directly to avoid triggering getEnvironmentConfig() at module-load time.
  // Module-level LRUCache instances are constructed before .env is loaded, and going
  // through getEnvironmentConfig() produces a noisy early-access warning.
  return getEnv("VF_DISABLE_LRU_INTERVAL") === "1";
}
