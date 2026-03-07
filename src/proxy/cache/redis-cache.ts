import { createClient, type RedisClientType } from "redis";
import type { CacheStats, RedisCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";
import { withSpan } from "../tracing.ts";
import { proxyLogger } from "../logger.ts";

const logger = proxyLogger.child({ module: "redis-cache" });
const DEFAULT_PREFIX = "vf:token:";
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_SCAN_COUNT = 100;
const MAX_RECONNECT_RETRIES = 3;
const RECONNECT_BACKOFF_BASE_MS = 100;
const RECONNECT_BACKOFF_MAX_MS = 3_000;

export class RedisCache implements TokenCache {
  private client: RedisClientType | null = null;
  private readonly prefix: string;
  private readonly url: string;
  private readonly connectTimeout: number;
  private hits = 0;
  private misses = 0;
  private connected = false;

  constructor(options: RedisCacheOptions) {
    this.url = options.url;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(
      "cache.redis.get",
      async () => {
        try {
          const client = await this.getConnectedClient();
          const data = await client.get(this.key(key));

          if (!data) {
            this.misses++;
            return null;
          }

          const entry = JSON.parse(data) as TokenCacheEntry;

          if (Date.now() >= entry.expiresAt) {
            await client.del(this.key(key));
            this.misses++;
            return null;
          }

          this.hits++;
          return entry;
        } catch (error) {
          logger.error("[RedisCache] Get error", {
            error: error instanceof Error ? error.message : String(error),
          });
          this.connected = false;
          this.misses++;
          throw error;
        }
      },
      { "cache.key": key },
    );
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      "cache.redis.set",
      async () => {
        try {
          const client = await this.getConnectedClient();
          const ttlMs = entry.expiresAt - Date.now();
          const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
          await client.setEx(this.key(key), ttlSeconds, JSON.stringify(entry));
        } catch (error) {
          logger.error("[RedisCache] Set error", {
            error: error instanceof Error ? error.message : String(error),
          });
          this.connected = false;
          throw error;
        }
      },
      { "cache.key": key },
    );
  }

  async delete(key: string): Promise<void> {
    return withSpan(
      "cache.redis.delete",
      async () => {
        try {
          const client = await this.getConnectedClient();
          await client.del(this.key(key));
        } catch (error) {
          logger.error("[RedisCache] Delete error", {
            error: error instanceof Error ? error.message : String(error),
          });
          this.connected = false;
          throw error;
        }
      },
      { "cache.key": key },
    );
  }

  async clear(): Promise<void> {
    return withSpan("cache.redis.clear", async () => {
      try {
        const client = await this.getConnectedClient();

        const pattern = `${this.prefix}*`;
        let cursor = 0;
        let totalDeleted = 0;

        do {
          const { cursor: nextCursor, keys } = await client.scan(cursor, {
            MATCH: pattern,
            COUNT: DEFAULT_SCAN_COUNT,
          });

          cursor = nextCursor;

          if (keys.length > 0) {
            totalDeleted += await client.del(keys);
          }
        } while (cursor !== 0);

        if (totalDeleted > 0) {
          logger.info(`[RedisCache] Cleared ${totalDeleted} keys`);
        }

        this.hits = 0;
        this.misses = 0;
      } catch (error) {
        logger.error("[RedisCache] Clear error", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.connected = false;
        throw error;
      }
    });
  }

  async has(key: string): Promise<boolean> {
    return withSpan(
      "cache.redis.has",
      async () => {
        try {
          const client = await this.getConnectedClient();
          return (await client.exists(this.key(key))) === 1;
        } catch (error) {
          logger.error("[RedisCache] Has error", {
            error: error instanceof Error ? error.message : String(error),
          });
          this.connected = false;
          throw error;
        }
      },
      { "cache.key": key },
    );
  }

  async stats(): Promise<CacheStats> {
    return withSpan("cache.redis.stats", async () => {
      let size = 0;

      try {
        const client = await this.getConnectedClient();
        size = await client.dbSize();
      } catch (error) {
        this.connected = false;
        logger.error("[RedisCache] Stats error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return { hits: this.hits, misses: this.misses, size, type: "redis" as const };
    });
  }

  async close(): Promise<void> {
    return withSpan("cache.redis.close", async () => {
      const client = this.client;
      if (!client) {
        this.connected = false;
        return;
      }

      try {
        await client.quit();
      } catch (_) {
        // expected: close errors are non-critical
      } finally {
        this.client = null;
        this.connected = false;
      }
    });
  }

  private async getConnectedClient(): Promise<RedisClientType> {
    await this.ensureConnected();
    if (!this.client) {
      throw new Error("Redis client not available after connect");
    }
    return this.client;
  }

  private async ensureConnected(): Promise<void> {
    return withSpan("cache.redis.connect", async () => {
      if (this.connected && this.client) return;

      const client = createClient({
        url: this.url,
        socket: {
          connectTimeout: this.connectTimeout,
          reconnectStrategy: (retries) => {
            if (retries > MAX_RECONNECT_RETRIES) {
              return new Error("Max reconnection attempts reached");
            }
            return Math.min(retries * RECONNECT_BACKOFF_BASE_MS, RECONNECT_BACKOFF_MAX_MS);
          },
        },
      });

      client.on("error", (err) => {
        logger.error("[RedisCache] Client error", {
          error: err instanceof Error ? err.message : String(err),
        });
        this.connected = false;
      });

      this.client = client as RedisClientType;
      await client.connect();
      this.connected = true;
      logger.info("[RedisCache] Connected");
    });
  }
}
