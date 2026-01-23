/**
 * API-Backed Cache Store for Render Results
 *
 * Uses the VF API distributed cache (createCacheBackend) to store render results
 * across K8s pods. Serializes RenderResult to JSON for storage.
 *
 * This enables cross-pod render cache sharing in production:
 * - Pod A renders page → stores in distributed cache
 * - Pod B receives request → hits distributed cache → returns immediately
 *
 * Falls back to memory cache if distributed cache is unavailable.
 */

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
  private localCache: MemoryCacheStore;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;

  constructor(options: APICacheStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? "render";
    this.ttlSeconds = options.ttlSeconds ?? 3600; // 1 hour default
    this.localCache = new MemoryCacheStore({
      maxEntries: options.localMaxEntries ?? 200,
    });
  }

  private async getBackend(): Promise<CacheBackend> {
    if (this.backend) return this.backend;
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
        logger.warn("[APICacheStore] Failed to init distributed cache, using memory", {
          error,
        });
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
        // Convert Map to array for JSON serialization
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
        // Cast to MDXFrontmatter - the serialized data preserves the structure
        frontmatter: serialized.result.frontmatter as CachePayload["result"]["frontmatter"],
        headings: serialized.result.headings,
        // Convert array back to Map
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
    // Check local cache first (fast path)
    const local = await this.localCache.get(key);
    if (local) {
      return local;
    }

    // Check distributed cache
    try {
      const backend = await this.getBackend();
      const json = await backend.get(key);
      if (json) {
        const payload = this.deserialize(json);
        // Populate local cache for future fast reads
        await this.localCache.set(key, payload);
        logger.debug("[APICacheStore] Distributed cache hit", { key });
        return payload;
      }
    } catch (error) {
      logger.debug("[APICacheStore] Failed to read from distributed cache", {
        key,
        error,
      });
    }

    return undefined;
  }

  async set(key: string, value: CachePayload): Promise<void> {
    // Don't cache streaming results
    if (value.result.stream) {
      return;
    }

    // Store in local cache (fast reads)
    await this.localCache.set(key, value);

    // Store in distributed cache asynchronously (cross-pod sharing)
    this.getBackend()
      .then((backend) => {
        const json = this.serialize(value);
        return backend.set(key, json, this.ttlSeconds);
      })
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
    // Clear matching entries from local cache
    const localDeleted = await this.localCache.deleteByPrefix?.(prefix) ?? 0;

    // Distributed cache doesn't support prefix deletion directly
    // Entries will expire via TTL
    logger.debug("[APICacheStore] deleteByPrefix (local only)", {
      prefix,
      localDeleted,
    });

    return localDeleted;
  }

  async clear(): Promise<void> {
    await this.localCache.clear();
    // Distributed cache entries will expire via TTL
    logger.debug("[APICacheStore] Local cache cleared");
  }

  async destroy(): Promise<void> {
    await this.localCache.destroy();
    this.backend = null;
    this.backendInitPromise = null;
  }
}
