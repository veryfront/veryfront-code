import * as dntShim from "../../_dnt.shims.js";
import { LRUCacheAdapter } from "./cache/stores/memory/lru-cache-adapter.js";
import type { LRUCacheOptions } from "./cache/stores/memory/types.js";
import { DEFAULT_LRU_MAX_ENTRIES } from "./index.js";
import { unrefTimer } from "../platform/compat/process.js";
import { getDisableLruIntervalEnv } from "../config/env.js";

export interface LRUOptions {
  maxEntries?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

export class LRUCache<K, V> {
  private adapter: LRUCacheAdapter;
  private cleanupTimer?: ReturnType<typeof dntShim.setInterval>;
  private cleanupIntervalMs: number;
  private ttlMs?: number;

  constructor(options: LRUOptions = {}) {
    const adapterOptions: LRUCacheOptions = {
      maxEntries: options.maxEntries ?? DEFAULT_LRU_MAX_ENTRIES,
      ttlMs: options.ttlMs,
    };

    this.adapter = new LRUCacheAdapter(adapterOptions);
    this.ttlMs = options.ttlMs;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;

    if (this.ttlMs && this.ttlMs > 0) {
      this.startPeriodicCleanup();
    }
  }

  private startPeriodicCleanup(): void {
    if (shouldDisableInterval()) {
      return;
    }

    this.stopCleanupTimer();

    const timer = dntShim.setInterval(() => {
      this.adapter.cleanupExpired();
    }, this.cleanupIntervalMs);

    this.cleanupTimer = timer;

    // Unref the timer so it doesn't prevent process exit or cause test leaks
    unrefTimer(timer);
  }

  private stopCleanupTimer(): void {
    if (!this.cleanupTimer) {
      return;
    }
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
}

function shouldDisableInterval(): boolean {
  if ((dntShim.dntGlobalThis as Record<string, unknown>).__vfDisableLruInterval === true) {
    return true;
  }

  try {
    return getDisableLruIntervalEnv();
  } catch {
    return false;
  }
}
