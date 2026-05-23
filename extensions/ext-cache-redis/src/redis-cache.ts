/**
 * Redis-backed implementation of the `TokenCacheStore` contract.
 *
 * Ported from `src/proxy/cache/redis-cache.ts`. Self-contained — only depends
 * on the `redis` npm client and the contract-interface types; the extension's
 * tracing/logging are supplied by `ExtensionContext.logger` at setup time.
 *
 * @module extensions/ext-cache-redis/redis-cache
 */

import { createClient, type RedisClientType } from "redis";
import type { TokenCacheEntry, TokenCacheStats, TokenCacheStore } from "veryfront/extensions/cache";

const DEFAULT_PREFIX = "vf:token:";
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_SCAN_COUNT = 100;
const MAX_RECONNECT_RETRIES = 3;
const RECONNECT_BACKOFF_BASE_MS = 100;
const RECONNECT_BACKOFF_MAX_MS = 3_000;
const EXPECTED_DISCONNECT_PATTERNS = [
  "socket closed unexpectedly",
  "connection closed",
  "connection reset",
  "econnreset",
  "etimedout",
];

/** Constructor options for `RedisTokenCacheStore`. */
export interface RedisTokenCacheStoreOptions {
  url: string;
  prefix?: string;
  connectTimeout?: number;
  tls?: boolean;
  password?: string;
  username?: string;
}

/** Minimal logger surface; satisfies the `ExtensionLogger` shape. */
export interface RedisCacheLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const NOOP_LOGGER: RedisCacheLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExpectedDisconnect(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return EXPECTED_DISCONNECT_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Factory contract used by tests — swap in an in-memory stub. */
export type RedisClientFactory = (
  // deno-lint-ignore no-explicit-any
  opts: Record<string, any>,
) => RedisClientType;

export class RedisTokenCacheStore implements TokenCacheStore {
  private client: RedisClientType | null = null;
  private readonly prefix: string;
  private readonly url: string;
  private readonly connectTimeout: number;
  private readonly tls: boolean;
  private readonly password?: string;
  private readonly username?: string;
  private readonly logger: RedisCacheLogger;
  private readonly clientFactory: RedisClientFactory;
  private hits = 0;
  private misses = 0;
  private connected = false;

  constructor(
    options: RedisTokenCacheStoreOptions,
    deps: {
      logger?: RedisCacheLogger;
      clientFactory?: RedisClientFactory;
    } = {},
  ) {
    this.url = options.url;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.tls = options.tls ?? options.url.startsWith("rediss://");
    this.password = options.password;
    this.username = options.username;
    this.logger = deps.logger ?? NOOP_LOGGER;
    this.clientFactory = deps.clientFactory ?? ((opts) => createClient(opts) as RedisClientType);
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
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
      this.logger.error("[RedisCache] Get error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.connected = false;
      this.misses++;
      throw error;
    }
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    try {
      const client = await this.getConnectedClient();
      const ttlMs = entry.expiresAt - Date.now();
      const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
      await client.setEx(this.key(key), ttlSeconds, JSON.stringify(entry));
    } catch (error) {
      this.logger.error("[RedisCache] Set error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.connected = false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const client = await this.getConnectedClient();
      await client.del(this.key(key));
    } catch (error) {
      this.logger.error("[RedisCache] Delete error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.connected = false;
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      const client = await this.getConnectedClient();

      const pattern = `${this.prefix}*`;
      // redis v5: scan cursor is string-based to prevent Number.MAX_SAFE_INTEGER overflow
      let cursor = "0";
      let totalDeleted = 0;

      do {
        // deno-lint-ignore no-explicit-any
        const result = await (client as any).scan(cursor, {
          MATCH: pattern,
          COUNT: DEFAULT_SCAN_COUNT,
        });

        cursor = String(result.cursor);

        if (result.keys.length > 0) {
          totalDeleted += await client.del(result.keys);
        }
      } while (cursor !== "0");

      if (totalDeleted > 0) {
        this.logger.info(`[RedisCache] Cleared ${totalDeleted} keys`);
      }

      this.hits = 0;
      this.misses = 0;
    } catch (error) {
      this.logger.error("[RedisCache] Clear error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.connected = false;
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const client = await this.getConnectedClient();
      return (await client.exists(this.key(key))) === 1;
    } catch (error) {
      this.logger.error("[RedisCache] Has error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.connected = false;
      throw error;
    }
  }

  async stats(): Promise<TokenCacheStats> {
    let size = 0;

    try {
      const client = await this.getConnectedClient();
      size = await client.dbSize();
    } catch (error) {
      this.connected = false;
      this.logger.error("[RedisCache] Stats error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { hits: this.hits, misses: this.misses, size, type: "redis" as const };
  }

  async close(): Promise<void> {
    const client = this.client;
    if (!client) {
      this.connected = false;
      return;
    }

    try {
      await client.close();
    } catch (_) {
      // expected: close errors are non-critical
    } finally {
      this.client = null;
      this.connected = false;
    }
  }

  private async getConnectedClient(): Promise<RedisClientType> {
    await this.ensureConnected();
    if (!this.client) {
      throw new Error("Redis client not available after connect");
    }
    return this.client;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.client) return;

    // deno-lint-ignore no-explicit-any
    const clientOpts: Record<string, any> = {
      url: this.url,
      socket: {
        connectTimeout: this.connectTimeout,
        tls: this.tls || undefined,
        reconnectStrategy: (retries: number) => {
          if (retries > MAX_RECONNECT_RETRIES) {
            return new Error("Max reconnection attempts reached");
          }
          return Math.min(retries * RECONNECT_BACKOFF_BASE_MS, RECONNECT_BACKOFF_MAX_MS);
        },
      },
    };
    if (this.password) clientOpts.password = this.password;
    if (this.username) clientOpts.username = this.username;

    const client = this.clientFactory(clientOpts);

    // deno-lint-ignore no-explicit-any
    (client as any).on?.("error", (err: unknown) => {
      this.connected = false;
      const error = getErrorMessage(err);
      if (isExpectedDisconnect(err)) {
        this.logger.info("[RedisCache] Client disconnected", { error });
        return;
      }
      this.logger.error("[RedisCache] Client error", { error });
    });

    this.client = client;
    await client.connect();
    this.connected = true;
    this.logger.info("[RedisCache] Connected");
  }
}
