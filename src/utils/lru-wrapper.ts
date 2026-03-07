import { LRUCacheAdapter } from "./cache/stores/memory/lru-cache-adapter.ts";
import type { LRUCacheOptions } from "./cache/stores/memory/types.ts";
import { DEFAULT_LRU_MAX_ENTRIES } from "#veryfront/utils";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

/** Default interval between expired-entry cleanup sweeps (1 minute) */
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

interface LRUOptions {
  maxEntries?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

export class LRUCache<K, V> {
  private adapter: LRUCacheAdapter;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupIntervalMs: number;
  private ttlMs?: number;

  constructor(options: LRUOptions = {}) {
    const adapterOptions: LRUCacheOptions = {
      maxEntries: options.maxEntries ?? DEFAULT_LRU_MAX_ENTRIES,
      ttlMs: options.ttlMs,
    };

    this.adapter = new LRUCacheAdapter(adapterOptions);
    this.ttlMs = options.ttlMs;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

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

  private toStringKey(key: K): string {
    return typeof key === "string" ? key : String(key);
  }

  get size(): number {
    return this.adapter.getStats().entries;
  }

  has(key: K): boolean {
    return this.adapter.get(this.toStringKey(key)) !== undefined;
  }

  get(key: K): V | undefined {
    return this.adapter.get<V>(this.toStringKey(key));
  }

  set(key: K, value: V): void {
    this.adapter.set(this.toStringKey(key), value);
  }

  delete(key: K): boolean {
    const stringKey = this.toStringKey(key);
    const had = this.adapter.get(stringKey) !== undefined;
    this.adapter.delete(stringKey);
    return had;
  }

  clear(): void {
    this.adapter.clear();
  }

  cleanup(): void {
    this.adapter.cleanupExpired();
  }

  destroy(): void {
    this.stopCleanupTimer();
    this.adapter.clear();
  }

  keys(): IterableIterator<K> {
    return this.adapter.keys() as IterableIterator<K>;
  }

  entries(): IterableIterator<[K, V]> {
    return this.adapter.entries<V>() as IterableIterator<[K, V]>;
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
