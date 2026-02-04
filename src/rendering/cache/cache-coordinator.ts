import { rendererLogger as logger } from "#veryfront/utils";
import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload, CacheStore } from "./types.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "./stores/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export interface CacheCoordinatorOptions {
  store?: CacheStore;
  memory?: MemoryCacheStoreOptions;
  ttlMs?: number;
  /**
   * Project identifier for cache key prefixing.
   * Required for multi-tenant isolation - all cache keys will be prefixed with this value.
   *
   * This should be a unique identifier per project:
   * - In production: The project UUID from the database
   * - In local dev: A hash generated from the projectDir (e.g., "proj_abc123")
   *
   * Note: This is NOT the human-readable projectSlug (like "minimal-app-router").
   * Use the unique ID to ensure cache isolation even if slugs are reused.
   */
  projectId?: string;
  /**
   * Content source identifier for cache isolation (e.g., "main", "release-123").
   * Ensures different branches/releases have separate cache entries.
   */
  contentSourceId?: string;
}

export interface CacheLookupResult {
  cachedResult?: RenderResult;
  depAwareSlug: string;
  moduleCacheKey: string;
  cachedModule?: RenderResult["pageModule"];
}

export class CacheCoordinator {
  private store: CacheStore;
  private ttlMs: number | undefined;
  private readonly defaultTtlMs = 5 * 60 * 1000; // 5 minutes
  private readonly projectId: string | undefined;
  private readonly contentSourceId: string | undefined;
  private readonly cachePrefix: string;

  constructor(options: CacheCoordinatorOptions = {}) {
    this.ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.projectId = options.projectId;
    this.contentSourceId = options.contentSourceId;

    // Build cache prefix for tenant isolation
    // Format: projectId:contentSourceId: (or empty if no projectId)
    this.cachePrefix = this.projectId
      ? `${this.projectId}:${this.contentSourceId ?? "draft"}:`
      : "";

    if (!this.projectId) {
      logger.warn(
        "[CacheCoordinator] No projectId provided - cache keys will not be tenant-isolated. " +
          "This may cause cross-project cache pollution in multi-tenant deployments.",
      );
    }

    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries,
        ttlMs: options.memory?.ttlMs ?? this.ttlMs,
      });
  }

  /**
   * Build a fully-qualified cache key with project prefix.
   * @param slug - The base slug or cache key
   * @param cacheKey - Optional explicit cache key (still gets prefixed)
   */
  private buildCacheKey(slug: string, cacheKey?: string): string {
    const baseKey = cacheKey ?? slug;
    return `${this.cachePrefix}${baseKey}`;
  }

  checkCache(slug: string, cacheKey?: string): Promise<CacheLookupResult> {
    const key = this.buildCacheKey(slug, cacheKey);

    return withSpan(
      "cache.checkCache",
      async () => {
        const cached = await this.store.get(key);

        if (!cached) {
          return { depAwareSlug: slug, moduleCacheKey: key };
        }

        if (this.isExpired(cached)) {
          await this.store.delete(key);
          return { depAwareSlug: slug, moduleCacheKey: key };
        }

        return {
          cachedResult: this.hydrateResult(cached),
          depAwareSlug: slug,
          moduleCacheKey: key,
          cachedModule: cached.result.pageModule,
        };
      },
      { "cache.slug": slug, "cache.key": key, "cache.projectId": this.projectId ?? "unknown" },
    );
  }

  persistResult(result: RenderResult, slug: string, cacheKey?: string): Promise<void> {
    if (result.stream) return Promise.resolve();

    const key = this.buildCacheKey(slug, cacheKey);

    return withSpan(
      "cache.persistResult",
      async () => {
        const now = Date.now();
        const payload: CachePayload = {
          result: {
            html: result.html,
            css: result.css,
            frontmatter: result.frontmatter,
            headings: result.headings,
            nodeMap: result.nodeMap ? new Map(result.nodeMap) : undefined,
            stream: null,
            ssrHash: result.ssrHash,
            pageModule: result.pageModule,
          },
          nodeMapEntries: result.nodeMap ? Array.from(result.nodeMap.entries()) : undefined,
          storedAt: now,
          expiresAt: this.ttlMs ? now + this.ttlMs : undefined,
        };

        await this.store.set(key, payload);
      },
      { "cache.slug": slug, "cache.key": key, "cache.projectId": this.projectId ?? "unknown" },
    );
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
  }

  async clearSlug(slug: string): Promise<void> {
    const prefixedSlug = this.buildCacheKey(slug);

    if (this.store.deleteByPrefix) {
      await this.store.deleteByPrefix(prefixedSlug);
    } else {
      await this.store.delete(prefixedSlug);
    }
  }

  /**
   * Clear all cache entries for the current project.
   * Only clears entries with the current project prefix.
   */
  async clearForProject(): Promise<void> {
    if (!this.projectId || !this.store.deleteByPrefix) {
      await this.clearAll();
      return;
    }

    await this.store.deleteByPrefix(this.cachePrefix);
  }

  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() > entry.expiresAt;
  }

  private hydrateResult(entry: CachePayload): RenderResult {
    let nodeMap: Map<number, unknown> | undefined;
    if (entry.nodeMapEntries) {
      nodeMap = new Map<number, unknown>(entry.nodeMapEntries);
    } else if (entry.result.nodeMap instanceof Map) {
      nodeMap = entry.result.nodeMap;
    } else if (entry.result.nodeMap && typeof entry.result.nodeMap === "object") {
      nodeMap = new Map<number, unknown>(
        Object.entries(entry.result.nodeMap).map(([k, v]) => [Number(k), v]),
      );
    }

    return {
      ...entry.result,
      nodeMap,
      stream: null,
    };
  }
}
