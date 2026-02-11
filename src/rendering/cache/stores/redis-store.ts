import type { CachePayload, CacheStore } from "../types.ts";
import { rendererLogger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { MemoryCacheStore } from "./memory-store.ts";

const logger = rendererLogger.component("redis");

interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  scan(cursor: number, options?: { MATCH?: string; COUNT?: number }): Promise<[number, string[]]>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Default TTL for Redis cache entries (1 hour) */
const DEFAULT_TTL_SECONDS = 3600;

export interface RedisCacheStoreOptions {
  url?: string;
  keyPrefix?: string;
  enableFallback?: boolean;
  /** TTL in seconds for cache entries (default: 3600 = 1 hour) */
  ttlSeconds?: number;
}

export class RedisCacheStore implements CacheStore {
  private client: RedisClient | null = null;
  private readonly url?: string;
  private readonly keyPrefix: string;
  private readonly enableFallback: boolean;
  private readonly ttlSeconds: number;
  private fallbackStore: MemoryCacheStore | null = null;
  private redisUnavailable = false;
  private errorLogged = false;

  constructor(options: RedisCacheStoreOptions = {}) {
    this.url = options.url;
    this.keyPrefix = options.keyPrefix ?? "veryfront:render:";
    this.enableFallback = options.enableFallback ?? false;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  private getFallbackStore(): MemoryCacheStore {
    if (this.fallbackStore) return this.fallbackStore;

    // Small fallback cache (100 entries) for when Redis is unavailable
    this.fallbackStore = new MemoryCacheStore({
      maxEntries: 100,
      ttlMs: this.ttlSeconds * 1000,
    });
    logger.warn("Redis unavailable, using memory cache fallback");
    return this.fallbackStore;
  }

  private async ensureClient(): Promise<RedisClient> {
    if (this.client) return this.client;

    let createClient: ((options: { url?: string }) => RedisClient) | undefined;
    try {
      // Construct module name dynamically to prevent Deno static analyzer
      // from trying to resolve this npm package during lint/check
      const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
      const mod = await import(redisClientModule);
      createClient = mod.createClient as (options: { url?: string }) => RedisClient;
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
    client.on?.("error", (err: unknown) => {
      // Only log the first error to avoid flooding logs during reconnection attempts
      if (!this.errorLogged) {
        logger.error("client error", err);
        this.errorLogged = true;
      }
      this.redisUnavailable = true;
    });

    await client.connect();
    this.client = client;
    this.redisUnavailable = false;
    this.errorLogged = false;
    return client;
  }

  private storageKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private shouldUseFallback(): boolean {
    return this.redisUnavailable && this.enableFallback;
  }

  private shouldSkipRedis(): boolean {
    return this.redisUnavailable && !this.enableFallback;
  }

  private markRedisUnavailable(): void {
    this.redisUnavailable = true;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    if (this.shouldUseFallback()) return this.getFallbackStore().get(key);
    if (this.shouldSkipRedis()) return undefined;

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
      this.markRedisUnavailable();

      if (!this.enableFallback) {
        logger.warn("get failed, skipping fallback", { key, error });
        return undefined;
      }

      logger.warn("get failed, using fallback", { key, error });
      return this.getFallbackStore().get(key);
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    if (this.shouldUseFallback()) return this.getFallbackStore().set(key, value);
    if (this.shouldSkipRedis()) return;

    try {
      const client = await this.ensureClient();
      // Apply TTL to prevent unbounded Redis growth
      await client.set(this.storageKey(key), JSON.stringify(value), { EX: this.ttlSeconds });
    } catch (error) {
      this.markRedisUnavailable();

      if (!this.enableFallback) {
        logger.warn("set failed, skipping fallback", { key, error });
        return;
      }

      logger.warn("set failed, using fallback", { key, error });
      await this.getFallbackStore().set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    if (this.shouldUseFallback()) return this.getFallbackStore().delete(key);
    if (this.shouldSkipRedis()) return;

    try {
      const client = await this.ensureClient();
      await client.del(this.storageKey(key));
    } catch (error) {
      this.markRedisUnavailable();

      if (!this.enableFallback) {
        logger.warn("delete failed, skipping fallback", { key, error });
        return;
      }

      logger.warn("delete failed, using fallback", { key, error });
      await this.getFallbackStore().delete(key);
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const localDeleted = (await this.fallbackStore?.deleteByPrefix?.(prefix)) ?? 0;

    if (this.redisUnavailable) return localDeleted;

    try {
      const client = await this.ensureClient();
      let cursor = 0;
      const keysToDelete: string[] = [];

      do {
        const [nextCursor, keys] = await client.scan(cursor, {
          MATCH: `${this.keyPrefix}${prefix}*`,
          COUNT: 100,
        });
        cursor = nextCursor;
        if (keys.length) keysToDelete.push(...keys);
      } while (cursor !== 0);

      if (!keysToDelete.length) return localDeleted;

      const deleteResults = await Promise.all(keysToDelete.map((key) => client.del(key)));
      const deleted = deleteResults.reduce((sum, count) => sum + count, 0);
      return localDeleted + deleted;
    } catch (error) {
      this.markRedisUnavailable();

      if (!this.enableFallback) {
        logger.warn("deleteByPrefix failed, skipping fallback", { prefix, error });
        return localDeleted;
      }

      logger.warn("deleteByPrefix failed, using fallback", { prefix, error });
      return localDeleted;
    }
  }

  async clear(): Promise<void> {
    await this.fallbackStore?.clear();

    if (this.redisUnavailable) return;

    try {
      const client = await this.ensureClient();
      let cursor = 0;

      do {
        const [nextCursor, keys] = await client.scan(cursor, {
          MATCH: `${this.keyPrefix}*`,
          COUNT: 50,
        });
        cursor = nextCursor;

        for (const key of keys) {
          await client.del(key);
        }
      } while (cursor !== 0);
    } catch (error) {
      this.markRedisUnavailable();

      if (!this.enableFallback) {
        logger.warn("clear failed, skipping fallback", { error });
        return;
      }

      logger.warn("clear failed", { error });
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
