import type { CachePayload, CacheStore, CacheStoreStats } from "../types.ts";
import { MemoryCacheStore } from "./memory-store.ts";
import { rendererLogger } from "#veryfront/utils";
import { type CacheBackend, createCacheBackend } from "#veryfront/cache/backend.ts";
import { cloneCachePayload, parseCachePayload, serializeCachePayload } from "../cache-payload.ts";
import { requirePositiveIntegerCacheTtlSeconds } from "#veryfront/cache/backends/ttl.ts";
import { escapeRedisCacheGlobLiteral } from "#veryfront/cache/backends/redis-keyspace.ts";

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
  /** Optional authoritative backend provider for embedding and deterministic tests. */
  backendFactory?: () => Promise<CacheBackend>;
}

export class APICacheStore implements CacheStore {
  private backend: CacheBackend | null = null;
  private backendInitPromise: Promise<CacheBackend> | null = null;
  private readonly localCache: MemoryCacheStore | null;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly localMaxEntries: number;
  private readonly localDeadlines = new Map<string, number>();
  private readonly backendFactory: () => Promise<CacheBackend>;
  private destroyed = false;

  constructor(options: APICacheStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? "render";
    if (
      this.keyPrefix.trim() !== this.keyPrefix ||
      this.keyPrefix.length === 0 ||
      this.keyPrefix.length > 128 ||
      /[\x00-\x1f\x7f*?\[\]\\]/.test(this.keyPrefix)
    ) {
      throw new TypeError(
        "API render cache keyPrefix must be a non-blank, glob-free value of at most 128 characters",
      );
    }
    this.ttlSeconds = requirePositiveIntegerCacheTtlSeconds(
      options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    );
    const localMaxEntries = options.localMaxEntries ?? DEFAULT_LOCAL_MAX_ENTRIES;
    if (!Number.isSafeInteger(localMaxEntries) || localMaxEntries <= 0) {
      throw new RangeError("API render cache localMaxEntries must be a positive safe integer");
    }
    this.localMaxEntries = localMaxEntries;
    this.backendFactory = options.backendFactory ?? (() =>
      createCacheBackend({
        keyPrefix: this.keyPrefix,
        preferredBackend: "api",
      }));

    const enableLocalCache = options.enableLocalCache ?? true;
    this.localCache = enableLocalCache
      ? new MemoryCacheStore({
        maxEntries: localMaxEntries,
        enforceStoreTtl: false,
      })
      : null;
  }

  private getBackend(): Promise<CacheBackend> {
    if (this.destroyed) {
      return Promise.reject(new Error("API render cache store has been destroyed"));
    }
    if (this.backend) return Promise.resolve(this.backend);
    if (this.backendInitPromise) return this.backendInitPromise;

    const initialization = (async () => {
      try {
        const backend = await this.backendFactory();
        if (
          !backend ||
          backend.type !== "api" ||
          typeof backend.get !== "function" ||
          typeof backend.set !== "function" ||
          typeof backend.del !== "function"
        ) {
          throw new TypeError("API render cache backend factory returned an invalid backend");
        }
        if (this.destroyed) {
          throw new Error("API render cache store was destroyed during initialization");
        }
        this.backend = backend;
        logger.debug("Distributed cache initialized", {
          type: backend.type,
        });
        return backend;
      } catch (error) {
        logger.warn(
          "[APICacheStore] Failed to initialize authoritative distributed cache",
          { error },
        );
        this.backend = null;
        throw error;
      }
    })();
    this.backendInitPromise = initialization;

    return initialization.finally(() => {
      if (this.backendInitPromise === initialization) this.backendInitPromise = null;
    });
  }

  private serialize(payload: CachePayload): string {
    return serializeCachePayload(payload);
  }

  private deserialize(json: string): CachePayload | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (_) {
      return undefined;
    }
    return parseCachePayload(parsed);
  }

  private resolveRetentionDeadline(value: CachePayload, now = Date.now()): number | null {
    const retainUntil = value.staleUntil ?? value.expiresAt;
    if (retainUntil !== undefined && retainUntil <= now) return null;
    return Math.max(now + this.ttlSeconds * 1_000, retainUntil ?? 0);
  }

  private async getLocal(key: string): Promise<CachePayload | undefined> {
    if (!this.localCache) return undefined;
    const deadline = this.localDeadlines.get(key);
    if (deadline === undefined || Date.now() >= deadline) {
      this.localDeadlines.delete(key);
      await this.localCache.delete(key);
      return undefined;
    }

    const value = await this.localCache.get(key);
    if (value === undefined) {
      this.localDeadlines.delete(key);
      return undefined;
    }
    this.localDeadlines.delete(key);
    this.localDeadlines.set(key, deadline);
    return value;
  }

  private async setLocal(key: string, value: CachePayload): Promise<void> {
    if (!this.localCache) return;
    const deadline = this.resolveRetentionDeadline(value);
    if (deadline === null) {
      await this.deleteLocal(key);
      return;
    }

    await this.localCache.set(key, value);
    this.localDeadlines.delete(key);
    this.localDeadlines.set(key, deadline);
    while (this.localDeadlines.size > this.localMaxEntries) {
      const oldestKey = this.localDeadlines.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.localDeadlines.delete(oldestKey);
      await this.localCache.delete(oldestKey);
    }
  }

  private async deleteLocal(key: string): Promise<void> {
    this.localDeadlines.delete(key);
    await this.localCache?.delete(key);
  }

  private async deleteLocalByPrefix(prefix: string): Promise<number> {
    for (const key of [...this.localDeadlines.keys()]) {
      if (key.startsWith(prefix)) this.localDeadlines.delete(key);
    }
    return (await this.localCache?.deleteByPrefix?.(prefix)) ?? 0;
  }

  private async clearLocal(): Promise<void> {
    this.localDeadlines.clear();
    await this.localCache?.clear();
  }

  async get(key: string): Promise<CachePayload | undefined> {
    if (this.destroyed) throw new Error("API render cache store has been destroyed");
    const local = await this.getLocal(key);
    if (local) return local;

    let backend: CacheBackend;
    let json: string | null;
    try {
      backend = await this.getBackend();
      json = await backend.get(key);
    } catch (error) {
      logger.debug("Failed to read from distributed cache", {
        key,
        error,
      });
      return undefined;
    }
    if (!json) return undefined;

    const payload = this.deserialize(json);
    if (!payload || this.resolveRetentionDeadline(payload) === null) {
      // Corruption/expiry cleanup is an attempted mutation. Do not misreport a
      // successful eviction when the authoritative backend rejected it.
      await backend.del(key);
      await this.deleteLocal(key);
      return undefined;
    }
    await this.setLocal(key, payload);
    logger.debug("Distributed cache hit", { key });
    return payload;
  }

  async set(key: string, value: CachePayload): Promise<void> {
    const snapshot = cloneCachePayload(value);
    const now = Date.now();
    if (this.resolveRetentionDeadline(snapshot, now) === null) {
      await this.delete(key);
      return;
    }
    const backend = await this.getBackend();
    await backend.set(
      key,
      this.serialize(snapshot),
      this.resolveBackendTtlSeconds(snapshot, now),
    );
    await this.setLocal(key, snapshot);
  }

  private resolveBackendTtlSeconds(value: CachePayload, now = Date.now()): number {
    const retainUntil = value.staleUntil ?? value.expiresAt;
    if (retainUntil === undefined) return this.ttlSeconds;

    const secondsUntilStaleExpiry = Math.ceil((retainUntil - now) / 1_000);
    if (secondsUntilStaleExpiry <= 0) {
      throw new RangeError("API render cache payload retention has already expired");
    }
    return Math.max(this.ttlSeconds, secondsUntilStaleExpiry);
  }

  async delete(key: string): Promise<void> {
    try {
      const backend = await this.getBackend();
      await backend.del(key);
    } catch (error) {
      await this.deleteLocal(key);
      throw error;
    }
    await this.deleteLocal(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let distributedDeleted: number;
    try {
      const backend = await this.getBackend();
      if (!backend.delByPattern) {
        throw new TypeError("API render cache backend does not support prefix invalidation");
      }
      distributedDeleted = await backend.delByPattern(
        `${escapeRedisCacheGlobLiteral(prefix)}*`,
      );
    } catch (error) {
      await this.deleteLocalByPrefix(prefix);
      throw error;
    }
    const localDeleted = await this.deleteLocalByPrefix(prefix);

    logger.debug("deleteByPrefix", {
      prefix,
      localDeleted,
      distributedDeleted,
    });

    return localDeleted + distributedDeleted;
  }

  async clear(): Promise<void> {
    try {
      const backend = await this.getBackend();
      if (!backend.delByPattern) {
        throw new TypeError("API render cache backend does not support clearing its namespace");
      }
      await backend.delByPattern("*");
    } catch (error) {
      await this.clearLocal();
      throw error;
    }
    await this.clearLocal();
    logger.debug("API and local caches cleared");
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.localDeadlines.clear();
    await this.localCache?.destroy();
    this.backend = null;
    this.backendInitPromise = null;
  }

  getStats(): CacheStoreStats {
    return this.localCache?.getStats() ?? { size: 0 };
  }
}
