import type { CachePayload, CacheStore, CacheStoreStats } from "../types.ts";
import { OwnedRedisClientConnection } from "#veryfront/extensions/distributed/owned-redis-client.ts";
import type { RedisClient } from "#veryfront/extensions/distributed";
import { rendererLogger } from "#veryfront/utils";
import { MemoryCacheStore } from "./memory-store.ts";
import { parseSerializedCachePayload, serializeCachePayload } from "../cache-payload.ts";

const logger = rendererLogger.component("redis");

/** Default TTL for Redis cache entries (1 hour) */
const DEFAULT_TTL_SECONDS = 3_600;
/** Max entries for the in-memory fallback cache when Redis is unavailable */
const FALLBACK_MAX_ENTRIES = 100;
/** Number of keys to scan per Redis SCAN iteration */
const REDIS_SCAN_COUNT = 100;
/** Smaller scan batch size for clear operations (deletes each key inline) */
const REDIS_CLEAR_SCAN_COUNT = 50;
const COMPARE_AND_DELETE_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

function isSuccessfulRedisDelete(value: unknown): boolean {
  return value === 1 || value === "1" || value === 1n;
}

export interface RedisCacheStoreOptions {
  url?: string;
  keyPrefix?: string;
  enableFallback?: boolean;
  /** TTL in seconds for cache entries (default: 3600 = 1 hour) */
  ttlSeconds?: number;
}

export class RedisCacheStore implements CacheStore {
  private readonly connection: OwnedRedisClientConnection;
  private readonly observedRawByPayload = new WeakMap<CachePayload, string>();
  private readonly keyPrefix: string;
  private readonly enableFallback: boolean;
  private readonly ttlSeconds: number;
  private fallbackStore: MemoryCacheStore | null = null;
  private redisUnavailable = false;
  private errorLogged = false;

  constructor(options: RedisCacheStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? "veryfront:render:";
    this.enableFallback = options.enableFallback ?? false;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.connection = new OwnedRedisClientConnection(
      options.url === undefined ? {} : { url: options.url },
      {
        onError: (error) => {
          if (!this.errorLogged) {
            logger.error("client error", error);
            this.errorLogged = true;
          }
          this.redisUnavailable = true;
        },
        onEnd: () => {
          this.redisUnavailable = true;
        },
        onCloseError(error) {
          logger.warn("client close failed", { error });
        },
      },
    );
  }

  private getFallbackStore(): MemoryCacheStore {
    if (this.fallbackStore) return this.fallbackStore;

    // Small fallback cache for when Redis is unavailable
    this.fallbackStore = new MemoryCacheStore({
      maxEntries: FALLBACK_MAX_ENTRIES,
      ttlMs: this.ttlSeconds * 1000,
    });
    logger.warn("Redis unavailable, using memory cache fallback");
    return this.fallbackStore;
  }

  private async ensureClient(): Promise<RedisClient> {
    const client = await this.connection.getClient();
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

      const parsed = parseSerializedCachePayload(raw);
      if (parsed !== undefined) this.observedRawByPayload.set(parsed, raw);
      return parsed;
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
      const serialized = serializeCachePayload(value);
      await client.set(this.storageKey(key), serialized, {
        EX: this.ttlSeconds,
      });
      this.observedRawByPayload.set(value, serialized);
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

  async deleteIfUnchanged(key: string, expected: CachePayload): Promise<boolean> {
    if (this.shouldUseFallback()) {
      return await this.getFallbackStore().deleteIfUnchanged(key, expected);
    }
    if (this.shouldSkipRedis()) return false;

    try {
      const client = await this.ensureClient();
      // Values returned by get() retain the exact bytes that were observed so
      // compare-and-delete remains correct across serialization upgrades.
      // Independently constructed values compare against the current canonical
      // serialization, which is the only byte sequence they can have observed.
      const comparisonValue = this.observedRawByPayload.get(expected) ??
        serializeCachePayload(expected);
      const deleted = await client.eval(COMPARE_AND_DELETE_SCRIPT, {
        keys: [this.storageKey(key)],
        arguments: [comparisonValue],
      });
      const succeeded = isSuccessfulRedisDelete(deleted);
      if (succeeded) this.observedRawByPayload.delete(expected);
      return succeeded;
    } catch (error) {
      this.markRedisUnavailable();
      logger.warn("compare-and-delete failed", { key, error });
      return false;
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
        const { cursor: nextCursor, keys } = await client.scan(cursor, {
          MATCH: `${this.keyPrefix}${prefix}*`,
          COUNT: REDIS_SCAN_COUNT,
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
        const { cursor: nextCursor, keys } = await client.scan(cursor, {
          MATCH: `${this.keyPrefix}*`,
          COUNT: REDIS_CLEAR_SCAN_COUNT,
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

    await this.connection.close();
  }

  getStats(): CacheStoreStats {
    return this.fallbackStore?.getStats() ?? { size: 0 };
  }
}
