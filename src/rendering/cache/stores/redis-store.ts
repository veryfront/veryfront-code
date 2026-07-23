import type { CachePayload, CacheStore, CacheStoreStats } from "../types.ts";
import { rendererLogger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors";
import { MemoryCacheStore } from "./memory-store.ts";

const logger = rendererLogger.component("redis");

export interface RedisCacheClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  scan(cursor: number, options?: { MATCH?: string; COUNT?: number }): Promise<[number, string[]]>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Default TTL for Redis cache entries (1 hour) */
const DEFAULT_TTL_SECONDS = 3_600;
/** Max entries for the in-memory fallback cache when Redis is unavailable */
const FALLBACK_MAX_ENTRIES = 100;
/** Number of keys to scan per Redis SCAN iteration */
const REDIS_SCAN_COUNT = 100;
/** Smaller scan batch size for clear operations (deletes each key inline) */
const REDIS_CLEAR_SCAN_COUNT = 50;

export interface RedisCacheStoreOptions {
  url?: string;
  keyPrefix?: string;
  enableFallback?: boolean;
  /** TTL in seconds for cache entries (default: 3600 = 1 hour) */
  ttlSeconds?: number;
  /** Redis client factory override for embedding and deterministic tests. */
  clientFactory?: () => Promise<RedisCacheClient>;
}

export class RedisCacheStore implements CacheStore {
  private client: RedisCacheClient | null = null;
  private clientInitPromise: Promise<RedisCacheClient> | null = null;
  private readonly url?: string;
  private readonly keyPrefix: string;
  private readonly enableFallback: boolean;
  private readonly ttlSeconds: number;
  private fallbackStore: MemoryCacheStore | null = null;
  private errorLogged = false;
  private readonly clientFactory?: () => Promise<RedisCacheClient>;

  constructor(options: RedisCacheStoreOptions = {}) {
    this.url = options.url;
    this.keyPrefix = options.keyPrefix ?? "veryfront:render:";
    this.enableFallback = options.enableFallback ?? false;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.clientFactory = options.clientFactory;
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new TypeError("Redis cache ttlSeconds must be a positive integer");
    }
    if (
      this.keyPrefix === "" || this.keyPrefix.length > 512 ||
      /[\0\r\n*?\[\]\\]/.test(this.keyPrefix)
    ) {
      throw new TypeError("Redis cache keyPrefix contains unsupported characters");
    }
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

  private async ensureClient(): Promise<RedisCacheClient> {
    if (this.client) return this.client;
    if (this.clientInitPromise) return await this.clientInitPromise;

    const initialization = this.createAndConnectClient();
    this.clientInitPromise = initialization;
    try {
      return await initialization;
    } finally {
      if (this.clientInitPromise === initialization) this.clientInitPromise = null;
    }
  }

  private async createAndConnectClient(): Promise<RedisCacheClient> {
    if (this.clientFactory) {
      const client = await this.clientFactory();
      await client.connect();
      this.client = client;
      this.markRedisAvailable();
      return client;
    }

    let createClient: ((options: { url?: string }) => RedisCacheClient) | undefined;
    try {
      // Construct module name dynamically to prevent Deno static analyzer
      // from trying to resolve this npm package during lint/check
      const redisClientModule = ["npm:@redis/client", "@1.5.8"].join("");
      const mod = await import(redisClientModule);
      createClient = mod.createClient as (options: { url?: string }) => RedisCacheClient;
    } catch (_) {
      /* expected: redis client package may not be installed */
      throw toError(
        createError({
          type: "render",
          message:
            "Redis cache store requires npm:@redis/client. Install dependencies or switch cache.render.type to 'memory' or 'filesystem'.",
        }),
      );
    }

    const client = createClient({ url: this.url });
    client.on?.("error", (err: unknown) => {
      // Only log the first error to avoid flooding logs during reconnection attempts
      if (!this.errorLogged) {
        logger.error("Redis client error", {
          errorName: err instanceof Error ? err.name : typeof err,
        });
        this.errorLogged = true;
      }
    });

    await client.connect();
    this.client = client;
    this.markRedisAvailable();
    return client;
  }

  private storageKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private markRedisAvailable(): void {
    this.errorLogged = false;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    try {
      const client = await this.ensureClient();
      const raw = await client.get(this.storageKey(key));
      this.markRedisAvailable();
      if (!raw) return await this.fallbackStore?.get(key);

      try {
        const payload = JSON.parse(raw) as unknown;
        if (isCachePayload(payload)) return payload;
        await client.del(this.storageKey(key));
        return undefined;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        /* expected: cached data may be corrupted or malformed JSON */
        await client.del(this.storageKey(key));
        return undefined;
      }
    } catch (error) {
      if (!this.enableFallback) {
        logger.warn("Redis get failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return undefined;
      }

      logger.warn("Redis get failed, using memory fallback", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return this.getFallbackStore().get(key);
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    try {
      const client = await this.ensureClient();
      // Apply TTL to prevent unbounded Redis growth
      await client.set(this.storageKey(key), JSON.stringify(value), { EX: this.ttlSeconds });
      this.markRedisAvailable();
      await this.fallbackStore?.delete(key);
    } catch (error) {
      if (!this.enableFallback) {
        logger.warn("Redis set failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return;
      }

      logger.warn("Redis set failed, using memory fallback", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      await this.getFallbackStore().set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.fallbackStore?.delete(key);

    try {
      const client = await this.ensureClient();
      await client.del(this.storageKey(key));
      this.markRedisAvailable();
    } catch (error) {
      if (!this.enableFallback) {
        logger.warn("Redis delete failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return;
      }

      logger.warn("Redis delete failed after clearing memory fallback", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const localDeleted = (await this.fallbackStore?.deleteByPrefix?.(prefix)) ?? 0;

    try {
      const client = await this.ensureClient();
      let cursor = 0;
      let distributedDeleted = 0;

      do {
        const [nextCursor, keys] = await client.scan(cursor, {
          MATCH: `${escapeRedisGlob(this.keyPrefix)}${escapeRedisGlob(prefix)}*`,
          COUNT: REDIS_SCAN_COUNT,
        });
        cursor = nextCursor;
        if (keys.length) distributedDeleted += await client.del(keys);
      } while (cursor !== 0);
      this.markRedisAvailable();
      return localDeleted + distributedDeleted;
    } catch (error) {
      if (!this.enableFallback) {
        logger.warn("Redis prefix deletion failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return localDeleted;
      }

      logger.warn("Redis prefix deletion failed after clearing memory fallback", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return localDeleted;
    }
  }

  async clear(): Promise<void> {
    await this.fallbackStore?.clear();

    try {
      const client = await this.ensureClient();
      let cursor = 0;

      do {
        const [nextCursor, keys] = await client.scan(cursor, {
          MATCH: `${escapeRedisGlob(this.keyPrefix)}*`,
          COUNT: REDIS_CLEAR_SCAN_COUNT,
        });
        cursor = nextCursor;

        for (const key of keys) {
          await client.del(key);
        }
      } while (cursor !== 0);
      this.markRedisAvailable();
    } catch (error) {
      if (!this.enableFallback) {
        logger.warn("Redis clear failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return;
      }

      logger.warn("Redis clear failed after clearing memory fallback", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  async destroy(): Promise<void> {
    if (this.fallbackStore) {
      await this.fallbackStore.destroy();
      this.fallbackStore = null;
    }

    if (!this.client) return;

    await this.client.disconnect();
    this.client = null;
  }

  getStats(): CacheStoreStats {
    return this.fallbackStore?.getStats() ?? { size: 0 };
  }
}

function escapeRedisGlob(value: string): string {
  return value.replace(/[\\*?\[\]]/g, "\\$&");
}

function isCachePayload(value: unknown): value is CachePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (typeof payload.storedAt !== "number" || !Number.isFinite(payload.storedAt)) return false;
  if (
    typeof payload.result !== "object" || payload.result === null || Array.isArray(payload.result)
  ) {
    return false;
  }
  const result = payload.result as Record<string, unknown>;
  return typeof result.html === "string" &&
    typeof result.frontmatter === "object" && result.frontmatter !== null &&
    !Array.isArray(result.frontmatter);
}
