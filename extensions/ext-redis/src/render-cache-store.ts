import { rendererLogger } from "veryfront/utils/logger";
import {
  type CachePayload,
  escapeCacheGlobLiteral,
  parseSerializedCachePayload,
  registerRenderDistributedCacheNamespace,
  type RenderCacheStore as CacheStore,
  requirePositiveIntegerCacheTtlSeconds,
  serializeCachePayload,
} from "veryfront/extensions/distributed/cache-support";
import {
  createRedisClientManager,
  type RedisClient,
  type RedisClientManager,
} from "./redis-client-manager.ts";

const logger = rendererLogger.component("redis");

/** Default TTL for Redis cache entries (1 hour) */
const DEFAULT_TTL_SECONDS = 3_600;
/** Number of keys to scan per Redis SCAN iteration */
const REDIS_SCAN_COUNT = 100;
/** Maximum keys passed to one DEL command. */
const REDIS_DELETE_BATCH_SIZE = 100;
/** Defensive bounds for untrusted/proxied SCAN implementations. */
const REDIS_MAX_SCAN_ITERATIONS = 1_000_000;
const REDIS_MAX_COLLECTED_KEYS = 100_000;

export interface RedisCacheStoreOptions {
  url?: string;
  connectTimeoutMs?: number;
  /** Canonical provider-neutral cache namespace. */
  keyPrefix?: string;
  /** TTL in seconds for cache entries (default: 3600 = 1 hour) */
  ttlSeconds?: number;
  /** Optional connection manager for embedding/tests. */
  clientManager?: RedisClientManager;
}

export class RedisCacheStore implements CacheStore {
  private readonly connectionOptions: Readonly<{ url?: string; connectTimeout?: number }>;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly clientManager: RedisClientManager;

  constructor(options: RedisCacheStoreOptions = {}) {
    this.connectionOptions = Object.freeze({
      url: options.url,
      connectTimeout: options.connectTimeoutMs,
    });
    this.keyPrefix = registerRenderDistributedCacheNamespace(
      options.keyPrefix ?? "vf:cache:render:",
    );
    this.clientManager = options.clientManager ?? createRedisClientManager();
    this.ttlSeconds = requirePositiveIntegerCacheTtlSeconds(
      options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    );
  }

  private async ensureClient(): Promise<RedisClient> {
    return await this.clientManager.getClient(this.connectionOptions);
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
        MATCH: `${escapeCacheGlobLiteral(literalPrefix)}*`,
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
      if (!raw) return undefined;

      const payload = parseSerializedCachePayload(raw);
      if (payload) return payload;
      await this.deleteRedisKey(client, this.storageKey(key));
      return undefined;
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.warn("get failed", { key, error });
      throw error;
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
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.warn("set failed", { key, error });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
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
    try {
      const client = await this.ensureClient();
      const keysToDelete = await this.scanKeys(client, `${this.keyPrefix}${prefix}`);
      const deleted = await this.deleteKeys(client, keysToDelete);
      return deleted;
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.warn("deleteByPrefix failed; Redis invalidation is incomplete", { prefix, error });
      throw error;
    }
  }

  async clear(): Promise<void> {
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
    await this.clientManager.disconnect();
  }
}
