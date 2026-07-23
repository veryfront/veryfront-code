import type { CachePayload, CacheStore } from "../types.ts";
import { cloneCachePayload, parseCachePayload } from "../cache-payload.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";

const DEFAULT_TTL_MS = 3_600_000;

type KvEntry<T> = { value?: T | null };

interface KVInstance {
  get<T = unknown>(key: unknown[]): Promise<KvEntry<T>>;
  set(key: unknown[], value: unknown, options?: { expireIn?: number }): Promise<unknown>;
  delete(key: unknown[]): Promise<void>;
  close?(): void | Promise<void>;
  list?(selector: { prefix: unknown[] }): AsyncIterable<{ key: unknown[] }>;
}

export type KVOpener = (path?: string) => Promise<unknown>;

export interface KVCacheStoreOptions {
  path?: string;
  /** Minimum physical retention in milliseconds. */
  ttlMs?: number;
  /** Optional opener for embedding and deterministic tests. */
  openKv?: KVOpener;
}

export class KVCacheStore implements CacheStore {
  private kv: KVInstance | null = null;
  private initialization: Promise<KVInstance> | null = null;
  private destroyPromise: Promise<void> | null = null;
  private destroyed = false;
  private readonly path?: string;
  private readonly configuredOpener?: KVOpener;
  private readonly ttlMs: number;

  constructor(options: KVCacheStoreOptions = {}) {
    this.path = options.path;
    this.configuredOpener = options.openKv;
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (
      !Number.isFinite(ttlMs) || ttlMs <= 0 ||
      ttlMs > MAX_CACHE_TTL_MILLISECONDS
    ) {
      throw new RangeError(
        `KV render cache ttlMs must be greater than 0 and at most ${MAX_CACHE_TTL_MILLISECONDS}`,
      );
    }
    this.ttlMs = Math.ceil(ttlMs);
  }

  private async ensureKV(): Promise<KVInstance> {
    if (this.destroyed) throw new Error("KV render cache store has been destroyed");
    if (this.kv) return this.kv;
    if (this.initialization) return await this.initialization;

    const initialization = this.openKV();
    this.initialization = initialization;
    try {
      const kv = await initialization;
      if (this.destroyed) {
        throw new Error("KV render cache store was destroyed during initialization");
      }
      this.kv = kv;
      return kv;
    } finally {
      if (this.initialization === initialization) this.initialization = null;
    }
  }

  private async openKV(): Promise<KVInstance> {
    const openKv = this.configuredOpener ?? (globalThis as typeof globalThis & {
      Deno?: { openKv?: (path?: string) => Promise<unknown> };
    }).Deno?.openKv;

    if (!openKv) {
      throw new TypeError("Deno.openKv is unavailable for the configured KV render cache");
    }

    const instance = await openKv(this.path);
    const kv = instance as Partial<KVInstance> | null;

    if (
      !kv ||
      typeof kv.get !== "function" ||
      typeof kv.set !== "function" ||
      typeof kv.delete !== "function"
    ) {
      const invalidInstance = instance as { close?: () => void | Promise<void> } | null;
      const validationError = new TypeError("Deno.openKv returned an invalid KV instance");
      try {
        await invalidInstance?.close?.();
      } catch (closeError) {
        throw new AggregateError(
          [validationError, closeError],
          "Invalid KV instance also failed to close",
        );
      }
      throw validationError;
    }

    return {
      get: kv.get.bind(instance) as KVInstance["get"],
      set: kv.set.bind(instance) as KVInstance["set"],
      delete: kv.delete.bind(instance) as KVInstance["delete"],
      close: typeof kv.close === "function" ? kv.close.bind(instance) : undefined,
      list: typeof kv.list === "function" ? kv.list.bind(instance) : undefined,
    };
  }

  async get(key: string): Promise<CachePayload | undefined> {
    const kv = await this.ensureKV();

    const result = await kv.get<unknown>(["veryfront", "render", key]);
    if (result.value === null || result.value === undefined) return undefined;
    const payload = parseCachePayload(result.value);
    if (payload) return payload;
    await kv.delete(["veryfront", "render", key]);
    return undefined;
  }

  async set(key: string, value: CachePayload): Promise<void> {
    const snapshot = cloneCachePayload(value);
    const retainUntil = snapshot.staleUntil ?? snapshot.expiresAt;
    if (retainUntil !== undefined && retainUntil <= Date.now()) {
      await this.delete(key);
      return;
    }
    const kv = await this.ensureKV();
    await kv.set(
      ["veryfront", "render", key],
      snapshot,
      { expireIn: this.resolveRetentionTtlMs(snapshot) },
    );
  }

  private resolveRetentionTtlMs(value: CachePayload, now = Date.now()): number {
    const retainUntil = value.staleUntil ?? value.expiresAt;
    if (retainUntil === undefined) return this.ttlMs;
    const remainingMs = Math.ceil(retainUntil - now);
    if (remainingMs <= 0) {
      throw new RangeError("KV render cache payload retention has already expired");
    }
    const ttlMs = Math.max(this.ttlMs, remainingMs);
    if (ttlMs > MAX_CACHE_TTL_MILLISECONDS) {
      throw new RangeError(
        `KV render cache retention exceeds ${MAX_CACHE_TTL_MILLISECONDS} milliseconds`,
      );
    }
    return ttlMs;
  }

  async delete(key: string): Promise<void> {
    const kv = await this.ensureKV();

    await kv.delete(["veryfront", "render", key]);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const kv = await this.ensureKV();
    if (!kv.list) {
      throw new TypeError("Configured KV render cache does not support prefix invalidation");
    }

    const keys: unknown[][] = [];

    for await (const entry of kv.list({ prefix: ["veryfront", "render"] })) {
      this.assertOwnedKey(entry.key);
      const key = entry.key[2];
      if (typeof key !== "string" || !key.startsWith(prefix)) continue;
      keys.push(entry.key);
    }

    for (const key of keys) await kv.delete(key);
    return keys.length;
  }

  async clear(): Promise<void> {
    const kv = await this.ensureKV();
    if (!kv.list) {
      throw new TypeError("Configured KV render cache does not support clearing its namespace");
    }

    const keys: unknown[][] = [];
    for await (const entry of kv.list({ prefix: ["veryfront", "render"] })) {
      this.assertOwnedKey(entry.key);
      keys.push(entry.key);
    }
    for (const key of keys) await kv.delete(key);
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyed = true;

    const active = this.kv;
    const initialization = this.initialization;
    this.kv = null;
    this.initialization = null;
    this.destroyPromise = (async () => {
      let instance = active;
      if (!instance && initialization) {
        try {
          instance = await initialization;
        } catch (_) {
          // A failed initialization does not own a live handle to close.
          return;
        }
      }
      await instance?.close?.();
    })();
    return this.destroyPromise;
  }

  private assertOwnedKey(key: unknown[]): void {
    if (
      key.length !== 3 ||
      key[0] !== "veryfront" ||
      key[1] !== "render" ||
      typeof key[2] !== "string"
    ) {
      throw new TypeError("KV list returned a key outside the render cache namespace");
    }
  }
}
