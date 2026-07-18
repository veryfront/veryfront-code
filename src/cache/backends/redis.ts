import { logger as baseLogger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "#veryfront/utils/redis-client.ts";
import type { CacheBackend } from "../types.ts";
import { buildBatchResults } from "../batch-results.ts";

const logger = baseLogger.component("redis-cache-backend");
const REDIS_PATTERN_DELETE_SCAN_COUNT = 100;
const REDIS_PATTERN_DELETE_BATCH_SIZE = 1000;

// Re-export for use by factory
export { isRedisConfigured };

export class RedisCacheBackend implements CacheBackend {
  readonly type = "redis" as const;
  private client: RedisClient | null = null;
  private keyPrefix: string;

  constructor(keyPrefix = "vf:cache:") {
    this.keyPrefix = keyPrefix;
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  initialize(): Promise<boolean> {
    if (!isRedisConfigured()) return Promise.resolve(false);

    return withSpan(
      SpanNames.CACHE_REDIS_INIT,
      async (span?: Span) => {
        try {
          this.client = await getRedisClient();
          span?.setAttribute("cache.redis.connected", true);
          return true;
        } catch (error) {
          span?.setAttribute("cache.redis.connected", false);
          logger.warn("Failed to connect", { error });
          return false;
        }
      },
      { "cache.key_prefix": this.keyPrefix },
    );
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      return await this.client.get(this.prefixKey(key));
    } catch (error) {
      logger.debug("Get failed", { key, error });
      return null;
    }
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    if (!this.client?.ttl) return null;

    try {
      const remaining = await this.client.ttl(this.prefixKey(key));
      if (remaining === -1) return Infinity;
      return remaining >= 0 ? remaining : null;
    } catch (error) {
      logger.debug("TTL lookup failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    if (!this.client) {
      return buildBatchResults(keys, () => null);
    }

    try {
      const prefixedKeys = keys.map((key) => this.prefixKey(key));
      let fetched: Array<string | null>;
      try {
        fetched = await this.client.mGet(prefixedKeys);
      } catch (error) {
        logger.debug("GetBatch MGET failed, falling back to GET", { keyCount: keys.length, error });
        const fallbackFetched = await Promise.all(
          keys.map(async (key) => [key, await this.get(key)] as const),
        );
        const fallbackValues = new Map(fallbackFetched);
        return buildBatchResults(keys, (key) => fallbackValues.get(key) ?? null);
      }
      const values = new Map(
        keys.map((key, index) => [key, fetched[index] ?? null] as const),
      );
      return buildBatchResults(keys, (key) => values.get(key) ?? null);
    } catch (error) {
      logger.debug("GetBatch failed", { keyCount: keys.length, error });
      return buildBatchResults(keys, () => null);
    }
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.set(this.prefixKey(key), value, { EX: ttlSeconds });
    } catch (error) {
      logger.debug("Set failed", { key, error });
    }
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (!this.client || entries.length === 0) return;

    try {
      await Promise.all(entries.map(({ key, value, ttl }) => this.set(key, value, ttl ?? 300)));
    } catch (error) {
      logger.debug("SetBatch failed", { entryCount: entries.length, error });
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.del(this.prefixKey(key));
    } catch (error) {
      logger.debug("Del failed", { key, error });
      throw error;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    if (!this.client) return 0;

    try {
      const client = this.client;
      const fullPattern = this.prefixKey(pattern);
      let cursor = 0;
      const keysToDelete: string[] = [];
      let deletedCount = 0;

      const flushDeleteBatch = async (): Promise<void> => {
        if (!keysToDelete.length) return;
        deletedCount += await client.del(keysToDelete.splice(0, keysToDelete.length));
      };

      do {
        const result = await client.scan(cursor, {
          MATCH: fullPattern,
          COUNT: REDIS_PATTERN_DELETE_SCAN_COUNT,
        });
        cursor = result.cursor;
        if (result.keys.length) {
          keysToDelete.push(...result.keys);
        }

        while (keysToDelete.length >= REDIS_PATTERN_DELETE_BATCH_SIZE) {
          const batch = keysToDelete.splice(0, REDIS_PATTERN_DELETE_BATCH_SIZE);
          deletedCount += await client.del(batch);
        }
      } while (cursor !== 0);

      await flushDeleteBatch();
      return deletedCount;
    } catch (error) {
      logger.debug("DelByPattern failed", { pattern, error });
      throw error;
    }
  }
}
