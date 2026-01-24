/**
 * Context-Aware Cache Coordinator
 *
 * Wraps the base CacheCoordinator to provide tenant isolation through
 * cache key prefixing. All cache operations include the RenderContext's
 * cachePrefix to prevent cross-project data leakage.
 *
 * @module rendering/shared/context-aware-cache
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import type { CacheStore } from "../cache/types.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "../cache/stores/index.ts";
import type { RenderContext } from "../context/render-context.ts";
import { createCacheKey } from "../context/render-context.ts";

/**
 * Options for the context-aware cache coordinator
 */
export interface ContextAwareCacheOptions {
  /** Underlying cache store */
  store?: CacheStore;
  /** Memory store options (if no store provided) */
  memory?: MemoryCacheStoreOptions;
  /** Default TTL in milliseconds */
  ttlMs?: number;
}

/**
 * Cache payload structure
 */
interface CachePayload {
  result: RenderResult;
  storedAt: number;
  expiresAt?: number;
}

/**
 * Cache lookup result
 */
export interface ContextAwareCacheLookupResult {
  /** Cached render result (if found and not expired) */
  cachedResult?: RenderResult;
  /** Full cache key used for lookup */
  cacheKey: string;
  /** Whether the result was found in cache */
  hit: boolean;
}

/**
 * Context-Aware Cache Coordinator
 *
 * Provides tenant-isolated caching by prefixing all cache keys with
 * the RenderContext's cachePrefix. This ensures that:
 *
 * 1. Project A's cached pages can never be served to Project B
 * 2. Preview and production caches are separate
 * 3. Different releases have separate caches
 *
 * Cache key format: "{projectId}:{environment}:{releaseKey}:{slug}"
 */
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

  /**
   * Check cache for a rendered page
   *
   * @param slug - Page slug to look up
   * @param ctx - Render context for tenant isolation
   * @param colorScheme - Optional color scheme for cache key variation
   * @returns Cache lookup result
   */
  async checkCache(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
  ): Promise<ContextAwareCacheLookupResult> {
    // Include colorScheme in cache key to prevent serving wrong theme
    // Use hyphen instead of equals sign (API cache key validation only allows: a-z A-Z 0-9 _ : . * - /)
    const themeKey = colorScheme ? `:theme-${colorScheme}` : "";
    const cacheKey = createCacheKey(ctx, `page:${slug}${themeKey}`);

    return await withSpan(
      SpanNames.CACHE_CHECK_SPECULATIVE,
      async () => {
        const cached = await this.store.get(cacheKey);

        if (cached && !this.isExpired(cached as CachePayload)) {
          logger.debug("[ContextAwareCache] Cache hit", {
            slug,
            projectId: ctx.projectId,
            environment: ctx.environment,
          });

          return {
            cachedResult: this.cloneResult((cached as CachePayload).result),
            cacheKey,
            hit: true,
          };
        }

        if (cached) {
          // Expired - clean up
          await this.store.delete(cacheKey);
          logger.debug("[ContextAwareCache] Cache expired", {
            slug,
            projectId: ctx.projectId,
          });
        }

        logger.debug("[ContextAwareCache] Cache miss", {
          slug,
          cacheKey,
          projectId: ctx.projectId,
          environment: ctx.environment,
        });
        return {
          cacheKey,
          hit: false,
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

  /**
   * Store a rendered page in cache
   *
   * @param result - Render result to cache
   * @param slug - Page slug
   * @param ctx - Render context for tenant isolation
   * @param colorScheme - Optional color scheme for cache key variation
   */
  async persistResult(
    result: RenderResult,
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
  ): Promise<void> {
    // Don't cache streaming results
    if (!result || result.stream) {
      return;
    }

    // Include colorScheme in cache key to prevent serving wrong theme
    // Use hyphen instead of equals sign (API cache key validation only allows: a-z A-Z 0-9 _ : . * - /)
    const themeKey = colorScheme ? `:theme-${colorScheme}` : "";
    const cacheKey = createCacheKey(ctx, `page:${slug}${themeKey}`);

    const payload: CachePayload = {
      result: this.cloneResult(result),
      storedAt: Date.now(),
      expiresAt: this.ttlMs ? Date.now() + this.ttlMs : undefined,
    };

    await this.store.set(cacheKey, payload);

    logger.debug("[ContextAwareCache] Cached result", {
      slug,
      projectId: ctx.projectId,
      environment: ctx.environment,
      cacheKey,
    });
  }

  /**
   * Clear all cached pages for a specific context
   *
   * This only clears pages matching the context's cachePrefix.
   * Other tenants' caches are not affected.
   *
   * @param ctx - Render context to clear cache for
   */
  async clearForContext(ctx: RenderContext): Promise<void> {
    const startTime = Date.now();
    if (this.store.deleteByPrefix) {
      logger.debug("[ContextAwareCache] Clearing cache for context", {
        projectId: ctx.projectId,
        environment: ctx.environment,
        cachePrefix: ctx.cachePrefix,
      });
      const deleted = await this.store.deleteByPrefix(ctx.cachePrefix);
      logger.info("[ContextAwareCache] ✓ Cleared cache for context", {
        projectId: ctx.projectId,
        environment: ctx.environment,
        cachePrefix: ctx.cachePrefix,
        entriesDeleted: deleted,
        durationMs: Date.now() - startTime,
      });
    } else {
      logger.warn("[ContextAwareCache] Store does not support prefix deletion", {
        projectId: ctx.projectId,
        cachePrefix: ctx.cachePrefix,
      });
    }
  }

  /**
   * Clear all cached pages for a specific project (across all environments).
   * Use this when you only have a projectId and want to clear all caches.
   *
   * @param projectId - Project ID to clear caches for
   */
  async clearForProject(projectId: string): Promise<void> {
    const startTime = Date.now();
    const prefix = `${projectId}:`;
    if (this.store.deleteByPrefix) {
      logger.debug("[ContextAwareCache] Clearing cache for project", {
        projectId,
        prefix,
      });
      // Cache keys are prefixed with projectId, so clear all with that prefix
      const deleted = await this.store.deleteByPrefix(prefix);
      logger.info("[ContextAwareCache] ✓ Cleared cache for project", {
        projectId,
        prefix,
        entriesDeleted: deleted,
        durationMs: Date.now() - startTime,
      });
    } else {
      logger.warn("[ContextAwareCache] Store does not support prefix deletion", {
        projectId,
      });
    }
  }

  /**
   * Clear a specific slug from cache (including all theme variants)
   *
   * @param slug - Page slug to clear
   * @param ctx - Render context for tenant isolation
   */
  async clearSlug(slug: string, ctx: RenderContext): Promise<void> {
    // Clear base key and both theme variants
    // Cache keys include :theme-light or :theme-dark suffix when colorScheme is used
    const baseKey = createCacheKey(ctx, `page:${slug}`);
    const lightKey = createCacheKey(ctx, `page:${slug}:theme-light`);
    const darkKey = createCacheKey(ctx, `page:${slug}:theme-dark`);

    await Promise.all([
      this.store.delete(baseKey),
      this.store.delete(lightKey),
      this.store.delete(darkKey),
    ]);

    logger.debug("[ContextAwareCache] Cleared slug from cache (all variants)", {
      slug,
      projectId: ctx.projectId,
      keys: [baseKey, lightKey, darkKey],
    });
  }

  /**
   * Clear all cached data (use with caution in multi-tenant environment)
   */
  async clearAll(): Promise<void> {
    await this.store.clear();
    logger.debug("[ContextAwareCache] Cleared all cached data");
  }

  /**
   * Destroy the cache coordinator
   */
  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number } {
    // Basic stats - stores can provide more detailed info
    return { size: 0 };
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
