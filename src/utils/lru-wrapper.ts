import { LRUCacheAdapter } from "./cache/stores/memory/lru-cache-adapter.ts";
import type { LRUCacheOptions } from "./cache/stores/memory/types.ts";
import { DEFAULT_LRU_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

/** Default interval between expired-entry cleanup sweeps (1 minute) */
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

interface LRUOptions {
  maxEntries?: number;
  /** Byte cap for stored values. Defaults to the adapter's 50 MiB limit. */
  maxSizeBytes?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

function requirePositiveFinite(value: number, option: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${option} must be a positive finite number`);
  }
  return value;
}

export class LRUCache<K, V> {
  private adapter: LRUCacheAdapter;
  private readonly internalKeys = new Map<K, string>();
  private readonly originalKeys = new Map<string, K>();
  private nextInternalKey = 0;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupIntervalMs: number;
  private ttlMs?: number;

  constructor(options: LRUOptions = {}) {
    const ttlMs = options.ttlMs === undefined
      ? undefined
      : requirePositiveFinite(options.ttlMs, "ttlMs");
    const cleanupIntervalMs = requirePositiveFinite(
      options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
      "cleanupIntervalMs",
    );
    const adapterOptions: LRUCacheOptions = {
      maxEntries: options.maxEntries ?? DEFAULT_LRU_MAX_ENTRIES,
      maxSizeBytes: options.maxSizeBytes,
      ttlMs,
      onEvict: (internalKey) => this.releaseInternalKey(internalKey),
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

  set(key: K, value: V): void {
    const { internalKey, created } = this.getOrCreateInternalKey(key);
    try {
      this.adapter.set(internalKey, value);
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
