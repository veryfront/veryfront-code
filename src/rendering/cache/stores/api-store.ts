import type { CachePayload, CacheStore, CacheStoreStats } from "../types.ts";
import { MemoryCacheStore } from "./memory-store.ts";
import { rendererLogger } from "#veryfront/utils";
import { type CacheBackend, createCacheBackend } from "#veryfront/cache/backend.ts";
import { parseSerializedCachePayload, serializeCachePayload } from "../cache-payload.ts";

const logger = rendererLogger.component("api-cache-store");

/** Default TTL for distributed cache entries (1 hour) */
const DEFAULT_TTL_SECONDS = 3_600;
/** Default max entries for the local memory cache (fast reads) */
const DEFAULT_LOCAL_MAX_ENTRIES = 200;

export interface APICacheStoreOptions {
  /** Key prefix for cache entries */
  keyPrefix?: string;
  /** TTL in seconds for distributed cache entries */
  ttlSeconds?: number;
  /** Max entries for local memory cache (fast reads) */
  localMaxEntries?: number;
  /** Disable local memory cache (no in-memory fallback) */
  enableLocalCache?: boolean;
}

export class APICacheStore implements CacheStore {
  private backend: CacheBackend | null = null;
  private backendInitPromise: Promise<CacheBackend> | null = null;
  private readonly localCache: MemoryCacheStore | null;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;

  constructor(options: APICacheStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? "render";
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    const enableLocalCache = options.enableLocalCache ?? true;
    this.localCache = enableLocalCache
      ? new MemoryCacheStore({
        maxEntries: options.localMaxEntries ?? DEFAULT_LOCAL_MAX_ENTRIES,
        ttlMs: this.ttlSeconds * 1000,
      })
      : null;
  }

  private getBackend(): Promise<CacheBackend> {
    if (this.backend) return Promise.resolve(this.backend);
    if (this.backendInitPromise) return this.backendInitPromise;

    this.backendInitPromise = (async () => {
      try {
        const backend = await createCacheBackend({
          keyPrefix: this.keyPrefix,
          preferredBackend: "api",
        });
        this.backend = backend;
        logger.debug("Distributed cache initialized", {
          type: backend.type,
        });
        return backend;
      } catch (error) {
        logger.warn(
          "[APICacheStore] Failed to init distributed cache, skipping fallback",
          { error },
        );
        this.backend = null;
        throw error;
      }
    })();

    return this.backendInitPromise;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    const local = await this.localCache?.get(key);
    if (local) return local;

    try {
      const backend = await this.getBackend();
      const json = await backend.get(key);
      if (!json) return undefined;

      const payload = parseSerializedCachePayload(json);
      if (payload === undefined) return undefined;
      await this.localCache?.set(key, payload);
      logger.debug("Distributed cache hit", { key });
      return payload;
    } catch (error) {
      logger.debug("Failed to read from distributed cache", {
        key,
        error,
      });
      return undefined;
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    if (value.result.stream) return;

    await this.localCache?.set(key, value);

    try {
      const backend = await this.getBackend();
      await backend.set(key, serializeCachePayload(value), this.resolveBackendTtlSeconds(value));
    } catch (error) {
      logger.debug(
        "[APICacheStore] Failed to store in distributed cache (no fallback)",
        { key, error },
      );
    }
  }

  private resolveBackendTtlSeconds(value: CachePayload): number {
    if (typeof value.staleUntil !== "number") return this.ttlSeconds;

    const secondsUntilStaleExpiry = Math.ceil((value.staleUntil - Date.now()) / 1_000);
    if (secondsUntilStaleExpiry <= 0) return this.ttlSeconds;
    return Math.max(this.ttlSeconds, secondsUntilStaleExpiry);
  }

  async delete(key: string): Promise<void> {
    await this.localCache?.delete(key);

    try {
      const backend = await this.getBackend();
      await backend.del(key);
    } catch (error) {
      logger.debug("Failed to delete from distributed cache", {
        key,
        error,
      });
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const localDeleted = (await this.localCache?.deleteByPrefix?.(prefix)) ?? 0;

    let distributedDeleted = 0;
    try {
      const backend = await this.getBackend();
      distributedDeleted = (await backend.delByPattern?.(`${prefix}*`)) ?? 0;
    } catch (error) {
      logger.debug("Failed to delete from distributed cache", {
        prefix,
        error,
      });
    }

    logger.debug("deleteByPrefix", {
      prefix,
      localDeleted,
      distributedDeleted,
    });

    return localDeleted + distributedDeleted;
  }

  async clear(): Promise<void> {
    await this.localCache?.clear();
    logger.debug("Local cache cleared");
  }

  async destroy(): Promise<void> {
    await this.localCache?.destroy();
    this.backend = null;
    this.backendInitPromise = null;
  }

  getStats(): CacheStoreStats {
    return this.localCache?.getStats() ?? { size: 0 };
  }
}
