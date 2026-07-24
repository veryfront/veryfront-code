import { logger as baseLogger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  disconnectRedisClient,
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
  type RedisClientManager,
} from "#veryfront/utils/redis-client.ts";
import type { CacheBackend } from "../types.ts";
import { buildBatchResults } from "../batch-results.ts";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  expiresImmediately,
  resolveIntegerCacheTtlSeconds,
} from "./ttl.ts";
import { escapeRedisCacheGlobLiteral, validateRedisCacheKeyPrefix } from "./redis-keyspace.ts";

const logger = baseLogger.component("redis-cache-backend");
const REDIS_PATTERN_DELETE_SCAN_COUNT = 100;
const REDIS_PATTERN_DELETE_BATCH_SIZE = 1_000;
const MAX_REDIS_PATTERN_DELETE_KEYS = 100_000;
const MAX_REDIS_SCAN_ITERATIONS = 1_000_000;

const sharedRedisClientManager: RedisClientManager = {
  getClient: getRedisClient,
  disconnect: disconnectRedisClient,
  isConfigured: isRedisConfigured,
};

export interface RedisCacheBackendOptions {
  clientManager?: RedisClientManager;
}

// Re-export for use by factory
export { isRedisConfigured };

export class RedisCacheBackend implements CacheBackend {
  readonly type = "redis" as const;
  private readonly keyPrefix: string;
  private readonly clientManager: RedisClientManager;

  constructor(keyPrefix = "vf:cache:", options: RedisCacheBackendOptions = {}) {
    this.keyPrefix = validateRedisCacheKeyPrefix(keyPrefix);
    this.clientManager = options.clientManager ?? sharedRedisClientManager;
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async resetAfterFailure(error: unknown): Promise<void> {
    try {
      await this.clientManager.disconnect();
    } catch (disconnectError) {
      logger.warn("Failed to reset Redis connection", { error, disconnectError });
    }
  }

  private async getClientForRead(): Promise<RedisClient | null> {
    if (!this.clientManager.isConfigured()) return null;
    try {
      return await this.clientManager.getClient();
    } catch (error) {
      logger.debug("Redis client acquisition failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  private async requireClient(): Promise<RedisClient> {
    if (!this.clientManager.isConfigured()) {
      throw new Error("Redis cache backend is not configured");
    }
    return await this.clientManager.getClient();
  }

  initialize(): Promise<boolean> {
    if (!this.clientManager.isConfigured()) return Promise.resolve(false);

    return withSpan(
      SpanNames.CACHE_REDIS_INIT,
      async (span?: Span) => {
        try {
          await this.clientManager.getClient();
          span?.setAttribute("cache.redis.connected", true);
          return true;
        } catch (error) {
          span?.setAttribute("cache.redis.connected", false);
          logger.warn("Failed to connect", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
          return false;
        }
      },
      { "cache.key_prefix": this.keyPrefix },
    );
  }

  async get(key: string): Promise<string | null> {
    const client = await this.getClientForRead();
    if (!client) return null;

    try {
      return await client.get(this.prefixKey(key));
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("Get failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    const client = await this.getClientForRead();
    if (!client?.ttl) return null;

    try {
      const remaining = await client.ttl(this.prefixKey(key));
      if (remaining === -1) return Infinity;
      return Number.isSafeInteger(remaining) && remaining >= 0 ? remaining : null;
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("TTL lookup failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    const client = await this.getClientForRead();
    if (!client) return buildBatchResults(keys, () => null);

    try {
      const prefixedKeys = keys.map((key) => this.prefixKey(key));
      const fetched = await client.mGet(prefixedKeys);
      if (
        !Array.isArray(fetched) ||
        fetched.length !== keys.length ||
        !fetched.every((value) => value === null || typeof value === "string")
      ) {
        throw new TypeError("Redis MGET returned an invalid result");
      }
      const values = new Map(
        keys.map((key, index) => [key, fetched[index] ?? null] as const),
      );
      return buildBatchResults(keys, (key) => values.get(key) ?? null);
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("GetBatch MGET failed, falling back to GET", {
        keyCount: keys.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      const fallbackFetched = await Promise.all(
        keys.map(async (key) => [key, await this.get(key)] as const),
      );
      const fallbackValues = new Map(fallbackFetched);
      return buildBatchResults(keys, (key) => fallbackValues.get(key) ?? null);
    }
  }

  async set(
    key: string,
    value: string,
    ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  ): Promise<void> {
    const ttl = resolveIntegerCacheTtlSeconds(ttlSeconds, DEFAULT_CACHE_TTL_SECONDS)!;
    if (expiresImmediately(ttl)) {
      await this.del(key);
      return;
    }

    const client = await this.requireClient();
    try {
      const result = await client.set(this.prefixKey(key), value, { EX: ttl });
      if (result !== "OK") throw new Error("Redis SET did not acknowledge the write");
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("Set failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    const finalEntriesByKey = new Map<string, { key: string; value: string; ttl: number }>();
    for (const { key, value, ttl } of entries) {
      finalEntriesByKey.set(key, {
        key,
        value,
        ttl: resolveIntegerCacheTtlSeconds(ttl, DEFAULT_CACHE_TTL_SECONDS)!,
      });
    }

    await Promise.all(
      [...finalEntriesByKey.values()].map(({ key, value, ttl }) => this.set(key, value, ttl)),
    );
  }

  async del(key: string): Promise<void> {
    const client = await this.requireClient();
    try {
      const deleted = await client.del(this.prefixKey(key));
      this.assertDeleteCount(deleted, 1);
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("Del failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    const client = await this.requireClient();

    try {
      const fullPattern = `${escapeRedisCacheGlobLiteral(this.keyPrefix)}${pattern}`;
      const keysToDelete = new Set<string>();
      const seenCursors = new Set<number>();
      let cursor = 0;
      let iterations = 0;

      do {
        if (++iterations > MAX_REDIS_SCAN_ITERATIONS) {
          throw new Error("Redis SCAN exceeded the safe iteration limit");
        }
        const result = await client.scan(cursor, {
          MATCH: fullPattern,
          COUNT: REDIS_PATTERN_DELETE_SCAN_COUNT,
        });
        if (
          !result ||
          !Number.isSafeInteger(result.cursor) ||
          result.cursor < 0 ||
          !Array.isArray(result.keys) ||
          !result.keys.every((key) => typeof key === "string" && key.startsWith(this.keyPrefix))
        ) {
          throw new TypeError("Redis returned an invalid SCAN result");
        }
        if (result.cursor !== 0 && seenCursors.has(result.cursor)) {
          throw new Error("Redis SCAN repeated a cursor before completing");
        }
        if (result.cursor !== 0) seenCursors.add(result.cursor);
        for (const key of result.keys) {
          keysToDelete.add(key);
          if (keysToDelete.size > MAX_REDIS_PATTERN_DELETE_KEYS) {
            throw new RangeError("Redis pattern deletion exceeds the safe key limit");
          }
        }
        cursor = result.cursor;
      } while (cursor !== 0);

      const keys = [...keysToDelete];
      let deletedCount = 0;
      for (let index = 0; index < keys.length; index += REDIS_PATTERN_DELETE_BATCH_SIZE) {
        const batch = keys.slice(index, index + REDIS_PATTERN_DELETE_BATCH_SIZE);
        const deleted = await client.del(batch);
        this.assertDeleteCount(deleted, batch.length);
        deletedCount += deleted;
      }
      return deletedCount;
    } catch (error) {
      await this.resetAfterFailure(error);
      logger.debug("DelByPattern failed", {
        patternLength: pattern.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  private assertDeleteCount(value: number, requested: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > requested) {
      throw new TypeError("Redis DEL returned an invalid count");
    }
  }
}
