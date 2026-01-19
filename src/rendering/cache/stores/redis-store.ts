import type { CachePayload, CacheStore } from "../types.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { MemoryCacheStore } from "./memory-store.ts";

interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | null>;
  del(key: string): Promise<number>;
  scan(cursor: number, options?: { MATCH?: string; COUNT?: number }): Promise<[number, string[]]>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface RedisCacheStoreOptions {
  url?: string;
  keyPrefix?: string;
  enableFallback?: boolean;
}

export class RedisCacheStore implements CacheStore {
  private client: RedisClient | null = null;
  private readonly url?: string;
  private readonly keyPrefix: string;
  private readonly enableFallback: boolean;
  private fallbackStore: MemoryCacheStore | null = null;
  private redisUnavailable = false;
  private errorLogged = false;

  constructor(options: RedisCacheStoreOptions = {}) {
    this.url = options.url;
    this.keyPrefix = options.keyPrefix ?? "veryfront:render:";
    this.enableFallback = options.enableFallback ?? true;
  }

  private getFallbackStore(): MemoryCacheStore {
    if (!this.fallbackStore) {
      // Small fallback cache (100 entries) for when Redis is unavailable
      this.fallbackStore = new MemoryCacheStore({ maxEntries: 100 });
      logger.warn("[redis] Redis unavailable, using memory cache fallback");
    }
    return this.fallbackStore;
  }

  private async ensureClient(): Promise<RedisClient> {
    if (this.client) {
      return this.client;
    }

    let createClient: ((options: { url?: string }) => RedisClient) | undefined;
    try {
      // Construct module name dynamically to prevent Deno static analyzer
      // from trying to resolve this npm package during lint/check
      const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
      const mod = await import(redisClientModule);
      createClient = mod.createClient as unknown as (options: { url?: string }) => RedisClient;
    } catch {
      throw toError(
        createError({
          type: "render",
          message:
            "Redis cache store requires npm:@redis/client. Install dependencies or switch cache.render.type to 'memory' or 'filesystem'.",
        }),
      );
    }

    const client = createClient({ url: this.url });
    if (typeof client?.on === "function") {
      client.on("error", (err: unknown) => {
        // Only log the first error to avoid flooding logs during reconnection attempts
        if (!this.errorLogged) {
          logger.error("[redis] client error", err);
          this.errorLogged = true;
        }
        this.redisUnavailable = true;
      });
    }

    await client.connect();
    this.client = client;
    this.redisUnavailable = false;
    this.errorLogged = false;
    return client;
  }

  private storageKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    if (this.redisUnavailable && this.enableFallback) {
      return this.getFallbackStore().get(key);
    }

    try {
      const client = await this.ensureClient();
      const raw = await client.get(this.storageKey(key));
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as CachePayload;
      } catch {
        return undefined;
      }
    } catch (error) {
      if (this.enableFallback) {
        logger.warn("[redis] get failed, using fallback", { key, error });
        this.redisUnavailable = true;
        return this.getFallbackStore().get(key);
      }
      throw error;
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    if (this.redisUnavailable && this.enableFallback) {
      return this.getFallbackStore().set(key, value);
    }

    try {
      const client = await this.ensureClient();
      await client.set(this.storageKey(key), JSON.stringify(value));
    } catch (error) {
      if (this.enableFallback) {
        logger.warn("[redis] set failed, using fallback", { key, error });
        this.redisUnavailable = true;
        return this.getFallbackStore().set(key, value);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    if (this.redisUnavailable && this.enableFallback) {
      return this.getFallbackStore().delete(key);
    }

    try {
      const client = await this.ensureClient();
      await client.del(this.storageKey(key));
    } catch (error) {
      if (this.enableFallback) {
        logger.warn("[redis] delete failed, using fallback", { key, error });
        this.redisUnavailable = true;
        return this.getFallbackStore().delete(key);
      }
      throw error;
    }
  }

  async clear(): Promise<void> {
    if (this.fallbackStore) {
      await this.fallbackStore.clear();
    }

    if (this.redisUnavailable && this.enableFallback) {
      return;
    }

    try {
      const client = await this.ensureClient();
      let cursor = 0;
      do {
        const [nextCursor, keys] = await client.scan(cursor, {
          MATCH: `${this.keyPrefix}*`,
          COUNT: 50,
        });
        cursor = nextCursor;
        if (keys.length > 0) {
          for (const key of keys) {
            await client.del(key);
          }
        }
      } while (cursor !== 0);
    } catch (error) {
      if (this.enableFallback) {
        logger.warn("[redis] clear failed", { error });
        this.redisUnavailable = true;
        return;
      }
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (this.fallbackStore) {
      await this.fallbackStore.destroy();
      this.fallbackStore = null;
    }

    if (!this.client) return;
    await this.client.disconnect();
    this.client = null;
  }
}
