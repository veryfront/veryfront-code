import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "#veryfront/utils/redis-client.ts";
import type { CacheBackend } from "../types.ts";

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
          logger.warn("[RedisCacheBackend] Failed to connect", { error });
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
      logger.debug("[RedisCacheBackend] Get failed", { key, error });
      return null;
    }
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    if (keys.length === 0) return results;

    if (!this.client) {
      for (const key of keys) results.set(key, null);
      return results;
    }

    try {
      const fetched = await Promise.all(
        keys.map(async (key) => [key, await this.get(key)] as const),
      );
      for (const [key, value] of fetched) results.set(key, value);
      return results;
    } catch (error) {
      logger.debug("[RedisCacheBackend] GetBatch failed", { keyCount: keys.length, error });
      for (const key of keys) results.set(key, null);
      return results;
    }
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.set(this.prefixKey(key), value, { EX: ttlSeconds });
    } catch (error) {
      logger.debug("[RedisCacheBackend] Set failed", { key, error });
    }
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (!this.client || entries.length === 0) return;

    try {
      await Promise.all(entries.map(({ key, value, ttl }) => this.set(key, value, ttl ?? 300)));
    } catch (error) {
      logger.debug("[RedisCacheBackend] SetBatch failed", { entryCount: entries.length, error });
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.del(this.prefixKey(key));
    } catch (error) {
      logger.debug("[RedisCacheBackend] Del failed", { key, error });
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    if (!this.client) return 0;

    try {
      const fullPattern = this.prefixKey(pattern);
      let cursor = 0;
      const keysToDelete: string[] = [];

      do {
        const result = await this.client.scan(cursor, { MATCH: fullPattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length) keysToDelete.push(...result.keys);
      } while (cursor !== 0);

      if (!keysToDelete.length) return 0;
      return await this.client.del(keysToDelete);
    } catch (error) {
      logger.debug("[RedisCacheBackend] DelByPattern failed", { pattern, error });
      return 0;
    }
  }
}
