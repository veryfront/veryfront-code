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
const MAX_PREFIX_CODE_UNITS = 256;
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

function validatePrefix(prefix: unknown): string {
  if (
    typeof prefix !== "string" ||
    prefix.length === 0 ||
    prefix.length > MAX_PREFIX_CODE_UNITS
  ) {
    throw new TypeError(
      "Redis token-cache prefix must contain 1 to 256 visible ASCII characters without glob metacharacters",
    );
  }

  for (let index = 0; index < prefix.length; index += 1) {
    const code = prefix.charCodeAt(index);
    if (
      code < 0x21 ||
      code > 0x7e ||
      code === 0x2a || // *
      code === 0x3f || // ?
      code === 0x5b || // [
      code === 0x5c || // \
      code === 0x5d // ]
    ) {
      throw new TypeError(
        "Redis token-cache prefix must contain 1 to 256 visible ASCII characters without glob metacharacters",
      );
    }
  }

  return prefix;
}

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
  private connecting: Promise<RedisClientType> | null = null;
  private closed = false;

  constructor(
    options: RedisTokenCacheStoreOptions,
    deps: {
      logger?: RedisCacheLogger;
      clientFactory?: RedisClientFactory;
    } = {},
  ) {
    this.url = options.url;
    this.prefix = validatePrefix(options.prefix ?? DEFAULT_PREFIX);
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
    let client: RedisClientType | null = null;
    try {
      client = await this.getConnectedClient();
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
      this.invalidate(client);
      this.misses++;
      throw error;
    }
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    // Reuse the already minted token: only an explicit replica refusal proves
    // that retrying this SET cannot duplicate an ambiguously accepted write.
    const value = JSON.stringify(entry);
    const expiresAt = entry.expiresAt;
    for (let attempt = 0; attempt < 2; attempt++) {
      let client: RedisClientType | null = null;
      try {
        client = await this.getConnectedClient();
        const ttlMs = expiresAt - Date.now();
        if (attempt > 0 && ttlMs <= 0) {
          throw new Error("Redis token-cache entry expired during replica recovery");
        }
        const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
        await client.setEx(this.key(key), ttlSeconds, value);
        return;
      } catch (error) {
        this.logger.error("[RedisCache] Set error", { error: getErrorMessage(error) });
        this.invalidate(client);
        if (
          attempt === 0 && client !== null && error instanceof Error &&
          error.message === "READONLY You can't write against a read only replica."
        ) continue;
        throw error;
      }
    }
  }

  async delete(key: string): Promise<void> {
    let client: RedisClientType | null = null;
    try {
      client = await this.getConnectedClient();
      await client.del(this.key(key));
    } catch (error) {
      this.logger.error("[RedisCache] Delete error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.invalidate(client);
      throw error;
    }
  }

  async clear(): Promise<void> {
    let client: RedisClientType | null = null;
    try {
      client = await this.getConnectedClient();

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
      this.invalidate(client);
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    let client: RedisClientType | null = null;
    try {
      client = await this.getConnectedClient();
      return (await client.exists(this.key(key))) === 1;
    } catch (error) {
      this.logger.error("[RedisCache] Has error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.invalidate(client);
      throw error;
    }
  }

  async stats(): Promise<TokenCacheStats> {
    let size = 0;
    let client: RedisClientType | null = null;

    try {
      client = await this.getConnectedClient();
      size = await client.dbSize();
    } catch (error) {
      this.invalidate(client);
      this.logger.error("[RedisCache] Stats error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { hits: this.hits, misses: this.misses, size, type: "extension" as const };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.invalidate(this.client);
  }

  /** Detach before destruction so late socket errors cannot affect its successor. */
  private invalidate(client: RedisClientType | null): void {
    if (!client || this.client !== client) return;
    this.client = null;
    this.connected = false;
    try {
      client.destroy();
    } catch {
      // Already-closed clients need no further cleanup.
    }
  }

  private getConnectedClient(): Promise<RedisClientType> {
    if (this.closed) return Promise.reject(new Error("Redis token-cache store is closed"));
    if (this.connected && this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    const connecting = this.connectClient();
    this.connecting = connecting;
    void connecting.finally(() => {
      if (this.connecting === connecting) this.connecting = null;
    }).catch(() => {});
    return connecting;
  }

  private async connectClient(): Promise<RedisClientType> {
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

    client.on("error", (err: unknown) => {
      if (this.client !== client) return;
      // Let connect() own its bounded startup reconnect policy. Once ready,
      // discard a failed socket so the next operation resolves the writer anew.
      if (this.connected) this.invalidate(client);
      const error = getErrorMessage(err);
      if (isExpectedDisconnect(err)) {
        this.logger.info("[RedisCache] Client disconnected", { error });
        return;
      }
      this.logger.error("[RedisCache] Client error", { error });
    });

    this.client = client;
    try {
      await client.connect();
      if (this.closed) throw new Error("Redis token-cache store is closed");
      if (this.client !== client) throw new Error("Redis client disconnected during connect");
      this.connected = true;
      this.logger.info("[RedisCache] Connected");
      return client;
    } catch (error) {
      this.invalidate(client);
      throw error;
    }
  }
}
