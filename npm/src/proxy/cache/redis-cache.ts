/**
 * Redis Token Cache
 *
 * Uses the standard `redis` package for cross-runtime compatibility.
 * Works in Deno, Node.js, and Bun.
 */

import { createClient, type RedisClientType } from "redis";
import type { CacheStats, RedisCacheOptions, TokenCache, TokenCacheEntry } from "./types.js";
import { withSpan } from "../tracing.js";

const DEFAULT_PREFIX = "vf:token:";
const DEFAULT_CONNECT_TIMEOUT = 5000;
const DEFAULT_SCAN_COUNT = 100;

export class RedisCache implements TokenCache {
  private client: RedisClientType | null = null;
  private prefix: string;
  private url: string;
  private connectTimeout: number;
  private hits = 0;
  private misses = 0;
  private connected = false;

  constructor(options: RedisCacheOptions) {
    this.url = options.url;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan("cache.redis.get", async () => {
      try {
        await this.ensureConnected();
        const data = await this.client!.get(this.key(key));

        if (!data) {
          this.misses++;
          return null;
        }

        const entry = JSON.parse(data) as TokenCacheEntry;

        if (Date.now() >= entry.expiresAt) {
          await this.client!.del(this.key(key));
          this.misses++;
          return null;
        }

        this.hits++;
        return entry;
      } catch (error) {
        console.error("[RedisCache] Get error:", error);
        this.connected = false;
        this.misses++;
        throw error;
      }
    }, { "cache.key": key });
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan("cache.redis.set", async () => {
      try {
        await this.ensureConnected();
        const ttlMs = entry.expiresAt - Date.now();
        const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
        await this.client!.setEx(this.key(key), ttlSeconds, JSON.stringify(entry));
      } catch (error) {
        console.error("[RedisCache] Set error:", error);
        this.connected = false;
        throw error;
      }
    }, { "cache.key": key });
  }

  async delete(key: string): Promise<void> {
    return withSpan("cache.redis.delete", async () => {
      try {
        await this.ensureConnected();
        await this.client!.del(this.key(key));
      } catch (error) {
        console.error("[RedisCache] Delete error:", error);
        this.connected = false;
        throw error;
      }
    }, { "cache.key": key });
  }

  async clear(): Promise<void> {
    return withSpan("cache.redis.clear", async () => {
      try {
        await this.ensureConnected();

        const pattern = `${this.prefix}*`;
        let cursor = "0";
        let totalDeleted = 0;

        do {
          const result = await this.client!.scan(cursor, {
            MATCH: pattern,
            COUNT: DEFAULT_SCAN_COUNT,
          });
          cursor = String(result.cursor);

          if (result.keys.length > 0) {
            totalDeleted += await this.client!.del(result.keys);
          }
        } while (cursor !== "0");

        if (totalDeleted > 0) {
          console.log(`[RedisCache] Cleared ${totalDeleted} keys`);
        }

        this.hits = 0;
        this.misses = 0;
      } catch (error) {
        console.error("[RedisCache] Clear error:", error);
        this.connected = false;
        throw error;
      }
    });
  }

  async has(key: string): Promise<boolean> {
    return withSpan("cache.redis.has", async () => {
      try {
        await this.ensureConnected();
        const exists = await this.client!.exists(this.key(key));
        return exists === 1;
      } catch (error) {
        console.error("[RedisCache] Has error:", error);
        this.connected = false;
        throw error;
      }
    }, { "cache.key": key });
  }

  async stats(): Promise<CacheStats> {
    return withSpan("cache.redis.stats", async () => {
      let size = 0;
      try {
        await this.ensureConnected();
        size = await this.client!.dbSize();
      } catch (error) {
        this.connected = false;
        console.warn("[RedisCache] Stats error:", error);
      }

      return { hits: this.hits, misses: this.misses, size, type: "redis" as const };
    });
  }

  async close(): Promise<void> {
    return withSpan("cache.redis.close", async () => {
      if (this.client) {
        try {
          await this.client.quit();
        } catch {
          // Ignore close errors
        }
        this.client = null;
      }
      this.connected = false;
    });
  }

  private async ensureConnected(): Promise<void> {
    return withSpan("cache.redis.connect", async () => {
      if (this.connected && this.client) {
        return;
      }

      // Create client with connection options
      this.client = createClient({
        url: this.url,
        socket: {
          connectTimeout: this.connectTimeout,
          reconnectStrategy: (retries) => {
            // Exponential backoff with max 3 retries
            if (retries > 3) {
              return new Error("Max reconnection attempts reached");
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      // Handle connection errors
      this.client.on("error", (err) => {
        console.error("[RedisCache] Client error:", err);
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;
      console.log("[RedisCache] Connected");
    });
  }
}
