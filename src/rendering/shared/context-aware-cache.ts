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
}

export interface ContextAwareCacheLookupResult {
  cachedResult?: RenderResult;
  cacheKey: string;
  hit: boolean;
}

export class ContextAwareCacheCoordinator {
  private store: CacheStore;
  private ttlMs?: number;

  constructor(options: ContextAwareCacheOptions = {}) {
    this.ttlMs = options.ttlMs;
    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries ?? 500,
        ttlMs: options.memory?.ttlMs ?? options.ttlMs,
      });
  }

  checkCache(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
  ): Promise<ContextAwareCacheLookupResult> {
    const cacheKey = this.getCacheKey(slug, ctx, colorScheme);

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
          cachedResult: this.cloneResult(cached.result),
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
  ): Promise<void> {
    if (!result || result.stream) return;

    const cacheKey = this.getCacheKey(slug, ctx, colorScheme);
    const now = Date.now();

    await this.store.set(cacheKey, {
      result: this.cloneResult(result),
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
  ): string {
    // Use hyphen instead of equals sign (API cache key validation only allows: a-z A-Z 0-9 _ : . * - /)
    const themeKey = colorScheme ? `:theme-${colorScheme}` : "";
    return createCacheKey(ctx, `page:${slug}${themeKey}`);
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() > entry.expiresAt;
  }

  private cloneResult(result: RenderResult): RenderResult {
    const cloned: RenderResult = {
      html: result.html,
      css: result.css,
      frontmatter: { ...result.frontmatter },
      headings: result.headings ? [...result.headings] : [],
      nodeMap: result.nodeMap ? new Map(result.nodeMap) : undefined,
      stream: null,
      ssrHash: result.ssrHash,
    };

    if (result.pageModule) {
      cloned.pageModule = { ...result.pageModule };
    }

    return cloned;
  }
}
