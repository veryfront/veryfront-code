import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import type { CacheStore } from "../cache/types.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "../cache/stores/index.ts";
import type { RenderContext } from "../context/render-context.ts";
import { createCacheKey } from "../context/render-context.ts";

export interface ContextAwareCacheOptions {
  store?: CacheStore;
  memory?: MemoryCacheStoreOptions;
  ttlMs?: number;
}

interface CachePayload {
  result: RenderResult;
  storedAt: number;
  expiresAt?: number;
  /** Optional serialized form of result.nodeMap for JSON-based stores */
  nodeMapEntries?: Array<[number, unknown]>;
}

export interface ContextAwareCacheLookupResult {
  cachedResult?: RenderResult;
  cacheKey: string;
  hit: boolean;
}

export class ContextAwareCacheCoordinator {
  private store: CacheStore;
  private ttlMs: number | undefined;
  private readonly defaultTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(options: ContextAwareCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries ?? 500,
        ttlMs: options.memory?.ttlMs ?? this.ttlMs,
      });
  }

  checkCache(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
    cacheKeyOverride?: string,
  ): Promise<ContextAwareCacheLookupResult> {
    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride);

    return withSpan(
      SpanNames.CACHE_CHECK_SPECULATIVE,
      async () => {
        const cached = (await this.store.get(cacheKey)) as CachePayload | undefined;

        if (!cached) {
          logger.debug("[ContextAwareCache] Cache miss", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
          });
          return { cacheKey, hit: false };
        }

        if (this.isExpired(cached)) {
          await this.store.delete(cacheKey);

          logger.debug("[ContextAwareCache] Cache expired", {
            slug,
            projectId: ctx.projectId,
          });

          logger.debug("[ContextAwareCache] Cache miss", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
          });

          return { cacheKey, hit: false };
        }

        logger.debug("[ContextAwareCache] Cache hit", {
          slug,
          projectId: ctx.projectId,
          environment: ctx.environment,
        });

        return {
          cachedResult: this.cloneResult(cached.result, cached.nodeMapEntries),
          cacheKey,
          hit: true,
        };
      },
      {
        "cache.key": cacheKey,
        "cache.slug": slug,
        "cache.project_id": ctx.projectId,
        "cache.environment": ctx.environment,
        "cache.color_scheme": colorScheme ?? "default",
      },
    );
  }

  async persistResult(
    result: RenderResult,
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
    cacheKeyOverride?: string,
  ): Promise<void> {
    if (!result || result.stream) return;

    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride);
    const now = Date.now();

    await this.store.set(cacheKey, {
      result: this.cloneResult(result),
      nodeMapEntries: result.nodeMap ? Array.from(result.nodeMap.entries()) : undefined,
      storedAt: now,
      expiresAt: this.ttlMs ? now + this.ttlMs : undefined,
    });

    logger.debug("[ContextAwareCache] Cached result", {
      slug,
      projectId: ctx.projectId,
      environment: ctx.environment,
      cacheKey,
    });
  }

  async clearForContext(ctx: RenderContext): Promise<void> {
    const startTime = Date.now();

    if (!this.store.deleteByPrefix) {
      logger.warn("[ContextAwareCache] Store does not support prefix deletion", {
        projectId: ctx.projectId,
        cachePrefix: ctx.cachePrefix,
      });
      return;
    }

    logger.debug("[ContextAwareCache] Clearing cache for context", {
      projectId: ctx.projectId,
      environment: ctx.environment,
      cachePrefix: ctx.cachePrefix,
    });

    const deleted = await this.store.deleteByPrefix(ctx.cachePrefix);

    logger.debug("[ContextAwareCache] ✓ Cleared cache for context", {
      projectId: ctx.projectId,
      entriesDeleted: deleted,
      durationMs: Date.now() - startTime,
    });
  }

  async clearForProject(projectId: string): Promise<void> {
    const startTime = Date.now();
    const prefix = `${projectId}:`;

    if (!this.store.deleteByPrefix) {
      logger.warn("[ContextAwareCache] Store does not support prefix deletion", { projectId });
      return;
    }

    logger.debug("[ContextAwareCache] Clearing cache for project", { projectId, prefix });

    const deleted = await this.store.deleteByPrefix(prefix);

    logger.debug("[ContextAwareCache] ✓ Cleared cache for project", {
      projectId,
      entriesDeleted: deleted,
      durationMs: Date.now() - startTime,
    });
  }

  async clearSlug(slug: string, ctx: RenderContext): Promise<void> {
    if (this.store.deleteByPrefix) {
      const prefix = createCacheKey(ctx, `page:${slug}`);
      await this.store.deleteByPrefix(prefix);
      logger.debug("[ContextAwareCache] Cleared slug from cache by prefix", {
        slug,
        projectId: ctx.projectId,
        prefix,
      });
      return;
    }

    const keys = [
      createCacheKey(ctx, `page:${slug}`),
      createCacheKey(ctx, `page:${slug}:theme-light`),
      createCacheKey(ctx, `page:${slug}:theme-dark`),
    ];

    await Promise.all(keys.map((key) => this.store.delete(key)));

    logger.debug("[ContextAwareCache] Cleared slug from cache (all variants)", {
      slug,
      projectId: ctx.projectId,
      keys,
    });
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
    logger.debug("[ContextAwareCache] Cleared all cached data");
  }

  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  getStats(): { size: number } {
    return { size: 0 };
  }

  private getCacheKey(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
    cacheKeyOverride?: string,
  ): string {
    // Use hyphen instead of equals sign (API cache key validation only allows: a-z A-Z 0-9 _ : . * - /)
    const themeKey = colorScheme ? `:theme-${colorScheme}` : "";
    const contentKey = cacheKeyOverride ?? `page:${slug}${themeKey}`;
    return createCacheKey(ctx, contentKey);
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() > entry.expiresAt;
  }

  private cloneResult(
    result: RenderResult,
    nodeMapEntries?: Array<[number, unknown]>,
  ): RenderResult {
    let nodeMap: Map<number, unknown> | undefined;
    if (nodeMapEntries) {
      nodeMap = new Map(nodeMapEntries);
    } else if (result.nodeMap instanceof Map) {
      nodeMap = new Map(result.nodeMap);
    } else if (result.nodeMap && typeof result.nodeMap === "object") {
      nodeMap = new Map(
        Object.entries(result.nodeMap as Record<string, unknown>).map(([k, v]) => [
          Number(k),
          v,
        ]),
      );
    }

    const cloned: RenderResult = {
      html: result.html,
      css: result.css,
      frontmatter: { ...result.frontmatter },
      headings: result.headings ? [...result.headings] : [],
      nodeMap,
      stream: null,
      ssrHash: result.ssrHash,
    };

    if (result.pageModule) {
      cloned.pageModule = { ...result.pageModule };
    }

    return cloned;
  }
}
