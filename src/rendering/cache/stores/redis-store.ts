import type { CachePayload, CacheStore, CacheStoreStats } from "../types.ts";
import { rendererLogger } from "#veryfront/utils";
import { MemoryCacheStore } from "./memory-store.ts";
import {
  buildRedisCacheScanPattern,
  registerLegacyRenderRedisCacheNamespace,
} from "#veryfront/cache/backends/redis-keyspace.ts";
import { requirePositiveIntegerCacheTtlSeconds } from "#veryfront/cache/backends/ttl.ts";
import { parseSerializedCachePayload, serializeCachePayload } from "../cache-payload.ts";
import {
  createRedisClientManager,
  type RedisClient,
  type RedisClientManager,
} from "#veryfront/utils/redis-client.ts";

const logger = rendererLogger.component("redis");

/** Default TTL for Redis cache entries (1 hour) */
const DEFAULT_TTL_SECONDS = 3_600;
/** Max entries for the in-memory fallback cache when Redis is unavailable */
const FALLBACK_MAX_ENTRIES = 100;
/** Number of keys to scan per Redis SCAN iteration */
const REDIS_SCAN_COUNT = 100;
/** Maximum keys passed to one DEL command. */
const REDIS_DELETE_BATCH_SIZE = 100;
/** Defensive bounds for untrusted/proxied SCAN implementations. */
const REDIS_MAX_SCAN_ITERATIONS = 1_000_000;
const REDIS_MAX_COLLECTED_KEYS = 100_000;

export interface RedisCacheStoreOptions {
  url?: string;
  /** Redis namespace; an omitted trailing colon is normalized for backward compatibility. */
  keyPrefix?: string;
  enableFallback?: boolean;
  /** TTL in seconds for cache entries (default: 3600 = 1 hour) */
  ttlSeconds?: number;
  /** Optional connection manager for embedding/tests. */
  clientManager?: RedisClientManager;
}

export class RedisCacheStore implements CacheStore {
  private readonly url?: string;
  private readonly keyPrefix: string;
  private readonly enableFallback: boolean;
  private readonly ttlSeconds: number;
  private readonly clientManager: RedisClientManager;
  private fallbackStore: MemoryCacheStore | null = null;
  private readonly fallbackDeadlines = new Map<string, number>();

  constructor(options: RedisCacheStoreOptions = {}) {
    this.url = options.url;
    this.keyPrefix = registerLegacyRenderRedisCacheNamespace(
      options.keyPrefix ?? "veryfront:render:",
    );
    this.enableFallback = options.enableFallback ?? false;
    this.clientManager = options.clientManager ?? createRedisClientManager();
    this.ttlSeconds = requirePositiveIntegerCacheTtlSeconds(
      options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    );
  }

  private getFallbackStore(): MemoryCacheStore {
    if (this.fallbackStore) return this.fallbackStore;

    // Small fallback cache for when Redis is unavailable
    this.fallbackStore = new MemoryCacheStore({
      maxEntries: FALLBACK_MAX_ENTRIES,
      enforceStoreTtl: false,
    });
    logger.warn("Redis unavailable, using memory cache fallback");
    return this.fallbackStore;
  }

  private async ensureClient(): Promise<RedisClient> {
    return await this.clientManager.getClient({ url: this.url });
  }

  private storageKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async resetRedisConnection(): Promise<void> {
    await this.clientManager.disconnect();
  }

  private async resetAfterFailure(error: unknown): Promise<void> {
    try {
      await this.resetRedisConnection();
    } catch (disconnectError) {
      logger.warn("failed to reset Redis connection", { error, disconnectError });
    }
  }

  private async scanKeys(client: RedisClient, literalPrefix: string): Promise<string[]> {
    let cursor = 0;
    let iterations = 0;
    const seenCursors = new Set<number>();
    const keys = new Set<string>();

    do {
      iterations++;
      if (iterations > REDIS_MAX_SCAN_ITERATIONS) {
        throw new Error("Redis SCAN exceeded the maximum iteration count");
      }
      const result = await client.scan(cursor, {
        MATCH: buildRedisCacheScanPattern(literalPrefix),
        COUNT: REDIS_SCAN_COUNT,
      });
      if (
        !result ||
        !Number.isSafeInteger(result.cursor) ||
        result.cursor < 0 ||
        !Array.isArray(result.keys) ||
        !result.keys.every((key) => typeof key === "string")
      ) {
        throw new TypeError("Redis returned an invalid SCAN result");
      }

      if (result.cursor !== 0 && seenCursors.has(result.cursor)) {
        throw new Error("Redis SCAN repeated a cursor before completing");
      }
      if (result.cursor !== 0) seenCursors.add(result.cursor);
      for (const key of result.keys) {
        if (!key.startsWith(literalPrefix)) {
          throw new Error("Redis SCAN returned a key outside the requested cache namespace");
        }
        keys.add(key);
        if (keys.size > REDIS_MAX_COLLECTED_KEYS) {
          throw new Error("Redis SCAN exceeded the maximum collected key count");
        }
      }
      cursor = result.cursor;
    } while (cursor !== 0);

    return [...keys];
  }

  private resolveRetentionTtlSeconds(value: CachePayload, now = Date.now()): number {
    const retainUntil = value.staleUntil ?? value.expiresAt;
    if (retainUntil === undefined) return this.ttlSeconds;
    const remainingSeconds = Math.ceil((retainUntil - now) / 1_000);
    if (remainingSeconds <= 0) {
      throw new RangeError("Redis render cache payload retention has already expired");
    }
    return requirePositiveIntegerCacheTtlSeconds(
      Math.max(this.ttlSeconds, remainingSeconds),
    );
  }

  private async setFallback(key: string, value: CachePayload): Promise<void> {
    const now = Date.now();
    const deadline = now + this.resolveRetentionTtlSeconds(value, now) * 1_000;
    const fallback = this.getFallbackStore();
    await fallback.set(key, value);
    this.fallbackDeadlines.delete(key);
    this.fallbackDeadlines.set(key, deadline);
    while (this.fallbackDeadlines.size > FALLBACK_MAX_ENTRIES) {
      const oldestKey = this.fallbackDeadlines.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.fallbackDeadlines.delete(oldestKey);
      await fallback.delete(oldestKey);
    }
  }

  private async getFallback(key: string): Promise<CachePayload | undefined> {
    const fallback = this.getFallbackStore();
    const deadline = this.fallbackDeadlines.get(key);
    if (deadline === undefined || Date.now() >= deadline) {
      this.fallbackDeadlines.delete(key);
      await fallback.delete(key);
      return undefined;
    }
    const value = await fallback.get(key);
    if (value === undefined) {
      this.fallbackDeadlines.delete(key);
      return undefined;
    }
    this.fallbackDeadlines.delete(key);
    this.fallbackDeadlines.set(key, deadline);
    return value;
  }

  private async deleteFallback(key: string): Promise<void> {
    this.fallbackDeadlines.delete(key);
    await this.fallbackStore?.delete(key);
  }

  private async deleteFallbackByPrefix(prefix: string): Promise<number> {
    for (const key of [...this.fallbackDeadlines.keys()]) {
      if (key.startsWith(prefix)) this.fallbackDeadlines.delete(key);
    }
    return (await this.fallbackStore?.deleteByPrefix?.(prefix)) ?? 0;
  }

  private async deleteKeys(client: RedisClient, keys: string[]): Promise<number> {
    let deleted = 0;
    for (let index = 0; index < keys.length; index += REDIS_DELETE_BATCH_SIZE) {
      const batch = keys.slice(index, index + REDIS_DELETE_BATCH_SIZE);
      const count = await client.del(batch);
      if (!Number.isSafeInteger(count) || count < 0 || count > batch.length) {
        throw new TypeError("Redis returned an invalid DEL count");
      }
      deleted += count;
    }
    return deleted;
  }

  private async deleteRedisKey(client: RedisClient, key: string): Promise<void> {
    const count = await client.del(key);
    if (!Number.isSafeInteger(count) || count < 0 || count > 1) {
      throw new TypeError("Redis returned an invalid DEL count");
    }
  }

  async get(key: string): Promise<CachePayload | undefined> {
    try {
      const client = await this.ensureClient();
      const raw = await client.get(this.storageKey(key));
      if (!raw) {
        await this.deleteFallback(key);
        return undefined;
      }

      const payload = parseSerializedCachePayload(raw);
      if (payload) {
        await this.deleteFallback(key);
        return payload;
      }
      await this.deleteRedisKey(client, this.storageKey(key));
      await this.deleteFallback(key);
      return undefined;
    } catch (error) {
      await this.resetAfterFailure(error);

      if (!this.enableFallback) {
        logger.warn("get failed, skipping fallback", { key, error });
        return undefined;
      }

      logger.warn("get failed, using fallback", { key, error });
      return this.getFallback(key);
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    const serialized = serializeCachePayload(value);
    const retainUntil = value.staleUntil ?? value.expiresAt;
    if (retainUntil !== undefined && retainUntil <= Date.now()) {
      await this.delete(key);
      return;
    }

    try {
      const client = await this.ensureClient();
      // Apply TTL to prevent unbounded Redis growth
      const result = await client.set(this.storageKey(key), serialized, {
        EX: this.resolveRetentionTtlSeconds(value),
      });
      if (result !== "OK") throw new Error("Redis SET did not acknowledge the write");
      await this.deleteFallback(key);
    } catch (error) {
      await this.resetAfterFailure(error);

      if (!this.enableFallback) {
        logger.warn("set failed", { key, error });
        throw error;
      }

      logger.warn("set failed, using fallback", { key, error });
      await this.setFallback(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.deleteFallback(key);

    try {
      const client = await this.ensureClient();
      await this.deleteRedisKey(client, this.storageKey(key));
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.warn("delete failed; Redis invalidation is incomplete", { key, error });
      throw error;
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const localDeleted = await this.deleteFallbackByPrefix(prefix);

    try {
      const client = await this.ensureClient();
      const keysToDelete = await this.scanKeys(client, `${this.keyPrefix}${prefix}`);
      const deleted = await this.deleteKeys(client, keysToDelete);
      return localDeleted + deleted;
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.warn("deleteByPrefix failed; Redis invalidation is incomplete", { prefix, error });
      throw error;
    }
  }

  async clear(): Promise<void> {
    this.fallbackDeadlines.clear();
    await this.fallbackStore?.clear();

    try {
      const client = await this.ensureClient();
      const keys = await this.scanKeys(client, this.keyPrefix);
      await this.deleteKeys(client, keys);
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.warn("clear failed; Redis invalidation is incomplete", { error });
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (this.fallbackStore) {
      await this.fallbackStore.destroy();
      this.fallbackStore = null;
    }
    this.fallbackDeadlines.clear();

    await this.clientManager.disconnect();
  }

  getStats(): CacheStoreStats {
    return this.fallbackStore?.getStats() ?? { size: 0 };
  }
}
