import { LRUCacheAdapter } from "./cache/stores/memory/lru-cache-adapter.ts";
import type { LRUCacheOptions } from "./cache/stores/memory/types.ts";
import { DEFAULT_LRU_MAX_ENTRIES } from "./constants/cache.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

/** Default interval between expired-entry cleanup sweeps (1 minute) */
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function requireCleanupInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(
      `cleanupIntervalMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return value;
}

interface LRUOptions {
  maxEntries?: number;
  /** Byte cap for stored values. Defaults to the adapter's 50 MiB limit. */
  maxSizeBytes?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

export class LRUCache<K, V> {
  private adapter: LRUCacheAdapter;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupIntervalMs: number;
  private ttlMs?: number;
  private readonly keyToAdapterKey = new Map<K, string>();
  private readonly adapterKeyToKey = new Map<string, K>();
  private nextAdapterKey = 0;

  constructor(options: LRUOptions = {}) {
    this.cleanupIntervalMs = requireCleanupInterval(
      options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
    );

    const adapterOptions: LRUCacheOptions = {
      maxEntries: options.maxEntries ?? DEFAULT_LRU_MAX_ENTRIES,
      maxSizeBytes: options.maxSizeBytes,
      ttlMs: options.ttlMs,
      onEvict: (adapterKey) => this.forgetAdapterKey(adapterKey),
    };

    this.adapter = new LRUCacheAdapter(adapterOptions);
    this.ttlMs = options.ttlMs;

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

  private getAdapterKey(key: K): string | undefined {
    return this.keyToAdapterKey.get(key);
  }

  private getOrCreateAdapterKey(key: K): string {
    const existing = this.keyToAdapterKey.get(key);
    if (existing !== undefined) return existing;

    if (!Number.isSafeInteger(this.nextAdapterKey)) {
      if (this.keyToAdapterKey.size !== 0) {
        throw new Error("LRU cache key space exhausted");
      }
      this.nextAdapterKey = 0;
    }

    const adapterKey = `k:${this.nextAdapterKey++}`;
    this.keyToAdapterKey.set(key, adapterKey);
    this.adapterKeyToKey.set(adapterKey, key);
    return adapterKey;
  }

  private forgetAdapterKey(adapterKey: string): void {
    if (!this.adapterKeyToKey.has(adapterKey)) return;
    const key = this.adapterKeyToKey.get(adapterKey) as K;
    this.adapterKeyToKey.delete(adapterKey);
    this.keyToAdapterKey.delete(key);
  }

  get size(): number {
    return this.adapter.getStats().entries;
  }

  has(key: K): boolean {
    const adapterKey = this.getAdapterKey(key);
    return adapterKey === undefined ? false : this.adapter.has(adapterKey);
  }

  get(key: K): V | undefined {
    const adapterKey = this.getAdapterKey(key);
    return adapterKey === undefined ? undefined : this.adapter.get<V>(adapterKey);
  }

  set(key: K, value: V): void {
    const adapterKey = this.getOrCreateAdapterKey(key);
    try {
      this.adapter.set(adapterKey, value);
    } catch (error) {
      if (!this.adapter.has(adapterKey)) this.forgetAdapterKey(adapterKey);
      throw error;
    }
  }

  delete(key: K): boolean {
    const adapterKey = this.getAdapterKey(key);
    if (adapterKey === undefined) return false;

    const had = this.adapter.has(adapterKey);
    if (had) this.adapter.delete(adapterKey);
    else this.forgetAdapterKey(adapterKey);
    return had;
  }

  clear(): void {
    this.adapter.clear();
    this.keyToAdapterKey.clear();
    this.adapterKeyToKey.clear();
  }

  cleanup(): void {
    this.adapter.cleanupExpired();
  }

  destroy(): void {
    this.stopCleanupTimer();
    this.clear();
  }

  *keys(): IterableIterator<K> {
    for (const adapterKey of this.adapter.keys()) {
      if (!this.adapterKeyToKey.has(adapterKey)) continue;
      yield this.adapterKeyToKey.get(adapterKey) as K;
    }
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [adapterKey, value] of this.adapter.entries<V>()) {
      if (!this.adapterKeyToKey.has(adapterKey)) continue;
      yield [this.adapterKeyToKey.get(adapterKey) as K, value];
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
