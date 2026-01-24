import type { CachePayload, CacheStore } from "../types.ts";
import { MemoryCacheStore } from "./memory-store.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import {
  type CacheBackend,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";

export interface APICacheStoreOptions {
  /** Key prefix for cache entries */
  keyPrefix?: string;
  /** TTL in seconds for distributed cache entries */
  ttlSeconds?: number;
  /** Max entries for local memory cache (fast reads) */
  localMaxEntries?: number;
}

/**
 * Serializable version of CachePayload for JSON storage
 */
interface SerializedCachePayload {
  result: {
    html: string;
    css?: string;
    frontmatter: Record<string, unknown>;
    headings?: Array<{ id: string; text: string; level: number }>;
    // nodeMap serialized as array of [key, value] pairs
    nodeMapEntries?: Array<[number, unknown]>;
    pageModule?: {
      slug: string;
      code: string;
      type: "mdx" | "component";
    };
    ssrHash?: string;
  };
  storedAt: number;
  expiresAt?: number;
}

export class APICacheStore implements CacheStore {
  private backend: CacheBackend | null = null;
  private backendInitPromise: Promise<CacheBackend> | null = null;
  private readonly localCache: MemoryCacheStore;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;

  constructor(options: APICacheStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? "render";
    this.ttlSeconds = options.ttlSeconds ?? 3600; // 1 hour default
    this.localCache = new MemoryCacheStore({
      maxEntries: options.localMaxEntries ?? 200,
      ttlMs: this.ttlSeconds * 1000,
    });
  }

  private getBackend(): Promise<CacheBackend> {
    if (this.backend) return Promise.resolve(this.backend);
    if (this.backendInitPromise) return this.backendInitPromise;

    this.backendInitPromise = createCacheBackend({ keyPrefix: this.keyPrefix })
      .then((backend) => {
        this.backend = backend;
        logger.debug("[APICacheStore] Distributed cache initialized", {
          type: backend.type,
        });
        return backend;
      })
      .catch((error) => {
        logger.warn(
          "[APICacheStore] Failed to init distributed cache, using memory",
          { error },
        );
        this.backend = new MemoryCacheBackend(200);
        return this.backend;
      });

    return this.backendInitPromise;
  }

  private serialize(payload: CachePayload): string {
    const serialized: SerializedCachePayload = {
      result: {
        html: payload.result.html,
        css: payload.result.css,
        frontmatter: payload.result.frontmatter as Record<string, unknown>,
        headings: payload.result.headings,
        nodeMapEntries: payload.result.nodeMap
          ? Array.from(payload.result.nodeMap.entries())
          : undefined,
        pageModule: payload.result.pageModule,
        ssrHash: payload.result.ssrHash,
      },
      storedAt: payload.storedAt,
      expiresAt: payload.expiresAt,
    };

    return JSON.stringify(serialized);
  }

  private deserialize(json: string): CachePayload {
    const serialized = JSON.parse(json) as SerializedCachePayload;

    return {
      result: {
        html: serialized.result.html,
        css: serialized.result.css,
        frontmatter: serialized.result.frontmatter as CachePayload["result"]["frontmatter"],
        headings: serialized.result.headings,
        nodeMap: serialized.result.nodeMapEntries
          ? new Map(serialized.result.nodeMapEntries)
          : undefined,
        stream: null, // Streams can't be serialized
        pageModule: serialized.result.pageModule,
        ssrHash: serialized.result.ssrHash,
      },
      storedAt: serialized.storedAt,
      expiresAt: serialized.expiresAt,
    };
  }

  async get(key: string): Promise<CachePayload | undefined> {
    const local = await this.localCache.get(key);
    if (local) return local;

    try {
      const backend = await this.getBackend();
      const json = await backend.get(key);
      if (!json) return undefined;

      const payload = this.deserialize(json);
      await this.localCache.set(key, payload);
      logger.debug("[APICacheStore] Distributed cache hit", { key });
      return payload;
    } catch (error) {
      logger.debug("[APICacheStore] Failed to read from distributed cache", {
        key,
        error,
      });
      return undefined;
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    if (value.result.stream) return;

    await this.localCache.set(key, value);

    this.getBackend()
      .then((backend) => backend.set(key, this.serialize(value), this.ttlSeconds))
      .catch((error) => {
        logger.debug("[APICacheStore] Failed to store in distributed cache", {
          key,
          error,
        });
      });
  }

  async delete(key: string): Promise<void> {
    await this.localCache.delete(key);

    try {
      const backend = await this.getBackend();
      await backend.del(key);
    } catch (error) {
      logger.debug("[APICacheStore] Failed to delete from distributed cache", {
        key,
        error,
      });
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const localDeleted = (await this.localCache.deleteByPrefix?.(prefix)) ?? 0;

    let distributedDeleted = 0;
    try {
      const backend = await this.getBackend();
      distributedDeleted = (await backend.delByPattern?.(`${prefix}*`)) ?? 0;
    } catch (error) {
      logger.debug("[APICacheStore] Failed to delete from distributed cache", {
        prefix,
        error,
      });
    }

    logger.debug("[APICacheStore] deleteByPrefix", {
      prefix,
      localDeleted,
      distributedDeleted,
    });

    return localDeleted + distributedDeleted;
  }

  async clear(): Promise<void> {
    await this.localCache.clear();
    logger.debug("[APICacheStore] Local cache cleared");
  }

  async destroy(): Promise<void> {
    await this.localCache.destroy();
    this.backend = null;
    this.backendInitPromise = null;
  }
}
