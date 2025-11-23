import type { CachePayload, CacheStore } from "../types.ts";

type KvEntry<T> = { value?: T | null };

interface KVInstance {
  get<T = unknown>(key: unknown[]): Promise<KvEntry<T>>;
  set(key: unknown[], value: unknown): Promise<void>;
  delete(key: unknown[]): Promise<void>;
  close?(): Promise<void>;
  list?(selector: { prefix: unknown[] }): AsyncIterable<{ key: unknown[] }>;
}

export interface KVCacheStoreOptions {
  path?: string;
}

export class KVCacheStore implements CacheStore {
  private kv: KVInstance | null = null;
  private readonly path?: string;

  constructor(options: KVCacheStoreOptions = {}) {
    this.path = options.path;
  }

  private async ensureKV(): Promise<KVInstance | null> {
    if (this.kv) return this.kv;
    const openKv = (globalThis as typeof globalThis & {
      Deno?: { openKv?: (path?: string) => Promise<unknown> };
    }).Deno?.openKv;
    if (!openKv) {
      return null;
    }
    const instance = await openKv(this.path) as unknown;
    if (!instance || typeof (instance as KVInstance).get !== "function") {
      return null;
    }
    const kv = instance as KVInstance;
    this.kv = {
      get: kv.get.bind(instance) as KVInstance["get"],
      set: kv.set.bind(instance),
      delete: kv.delete.bind(instance),
      close: typeof kv.close === "function" ? kv.close.bind(instance) : undefined,
      list: typeof kv.list === "function" ? kv.list.bind(instance) : undefined,
    };
    return this.kv;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    const kv = await this.ensureKV();
    if (!kv) return undefined;
    const result = await kv.get<CachePayload>(["veryfront", "render", key]);
    return (result.value ?? undefined) as CachePayload | undefined;
  }

  async set(key: string, value: CachePayload): Promise<void> {
    const kv = await this.ensureKV();
    if (!kv) return;
    await kv.set(["veryfront", "render", key], value);
  }

  async delete(key: string): Promise<void> {
    const kv = await this.ensureKV();
    if (!kv) return;
    await kv.delete(["veryfront", "render", key]);
  }

  async clear(): Promise<void> {
    const kv = await this.ensureKV();
    if (!kv) return;
    // Deno KV lacks a truncate; iterate keys.
    const entries = kv.list ? kv.list({ prefix: ["veryfront", "render"] }) : null;
    if (!entries) return;
    for await (const entry of entries as AsyncIterable<{ key: unknown[] }>) {
      await kv.delete(entry.key);
    }
  }

  async destroy(): Promise<void> {
    if (this.kv?.close) {
      await this.kv.close();
    }
    this.kv = null;
  }
}
