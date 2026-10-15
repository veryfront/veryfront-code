import { rendererLogger } from "#veryfront/utils";
import { markRequestProfilePhase, metrics, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload, CacheStore } from "../cache/types.ts";
import type { CacheLookupStatus } from "../cache/cache-coordinator.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "../cache/stores/index.ts";
import type { RenderContext } from "../context/render-context.ts";
import { createCacheKey } from "../context/render-context.ts";
import {
  bindHtmlNonceFromCache,
  isHtmlNonceCacheCompatible,
  sealHtmlNonceForCache,
} from "#veryfront/html/nonce-injection.ts";

const logger = rendererLogger.component("context-aware-cache");

/** Default TTL for context-aware cache entries (5 minutes) */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
/** Default stale window for expired public render entries (30 minutes). */
const DEFAULT_CACHE_STALE_MS = 30 * 60 * 1_000;
/** Default max entries for the in-memory cache store */
const DEFAULT_MAX_ENTRIES = 500;

export interface ContextAwareCacheOptions {
  store?: CacheStore;
  memory?: MemoryCacheStoreOptions;
  ttlMs?: number;
  staleMs?: number;
}

export interface ContextAwareCacheLookupResult {
  cachedResult?: RenderResult;
  cacheKey: string;
  hit: boolean;
  status: CacheLookupStatus;
  lookupDurationMs: number;
}

function hasResponseMetadata(result: RenderResult): boolean {
  return Object.keys(result.headers ?? {}).length > 0 || (result.cookies?.length ?? 0) > 0;
}

export class ContextAwareCacheCoordinator {
  private store: CacheStore;
  private ttlMs: number | undefined;
  private staleMs: number;
  private readonly defaultTtlMs = DEFAULT_CACHE_TTL_MS;
  private readonly maxTrackedVariants: number;
  // Exact keys are needed when a store cannot enumerate runtime/pinning variants.
  // Bound bookkeeping with the same least-recently-used order as cache reads.
  private readonly variants = new Map<string, {
    slugKey: string;
    expiresAt?: number;
    settled: boolean;
    write: Promise<void>;
  }>();

  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly keyWrites = new Map<string, Promise<void>>();

  constructor(options: ContextAwareCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.staleMs = options.staleMs ?? DEFAULT_CACHE_STALE_MS;
    this.maxTrackedVariants = options.memory?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries ?? DEFAULT_MAX_ENTRIES,
        ttlMs: options.memory?.ttlMs ?? this.ttlMs,
        enforceStoreTtl: false,
      });
  }

  checkCache(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
    cacheKeyOverride?: string,
    nonce?: string,
  ): Promise<ContextAwareCacheLookupResult> {
    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride);

    return withSpan(
      SpanNames.CACHE_CHECK_SPECULATIVE,
      async () => {
        const lookupStart = performance.now();
        const cached = (await this.store.get(cacheKey)) as CachePayload | undefined;
        const tracked = this.variants.get(cacheKey);
        if (tracked?.settled) {
          this.variants.delete(cacheKey);
          if (cached) this.variants.set(cacheKey, tracked);
        }

        if (!cached) {
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          logger.debug("Cache miss", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
            lookupDurationMs,
          });
          return { cacheKey, hit: false, status: "miss", lookupDurationMs };
        }

        if (hasResponseMetadata(cached.result)) {
          if (this.store.deleteIfUnchanged) {
            await this.store.deleteIfUnchanged(cacheKey, cached);
          } else {
            await this.store.delete(cacheKey);
          }
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          logger.debug("Rejected response-metadata-bearing cache entry", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
            lookupDurationMs,
          });
          return { cacheKey, hit: false, status: "miss", lookupDurationMs };
        }

        if (!isHtmlNonceCacheCompatible(cached.htmlNoncePlaceholder, nonce)) {
          await this.store.delete(cacheKey);
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          logger.debug("Rejected unsealed nonce cache entry", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
            lookupDurationMs,
          });
          return { cacheKey, hit: false, status: "miss", lookupDurationMs };
        }

        if (this.isExpired(cached)) {
          if (this.isStaleUsable(cached, ctx)) {
            const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
            recordCacheLookup("stale", lookupDurationMs);
            logger.debug("Cache stale hit", {
              slug,
              cacheKey,
              projectId: ctx.projectId,
              environment: ctx.environment,
              lookupDurationMs,
            });

            return {
              cachedResult: this.cloneResult(
                cached.result,
                cached.nodeMapEntries,
                cached.htmlNoncePlaceholder,
                nonce,
              ),
              cacheKey,
              hit: true,
              status: "stale",
              lookupDurationMs,
            };
          }

          await this.store.delete(cacheKey);

          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("expired", lookupDurationMs);
          logger.debug("Cache expired", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
            lookupDurationMs,
          });

          return { cacheKey, hit: false, status: "expired", lookupDurationMs };
        }

        const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
        recordCacheLookup("hit", lookupDurationMs);
        logger.debug("Cache hit", {
          slug,
          projectId: ctx.projectId,
          environment: ctx.environment,
          lookupDurationMs,
        });

        return {
          cachedResult: this.cloneResult(
            cached.result,
            cached.nodeMapEntries,
            cached.htmlNoncePlaceholder,
            nonce,
          ),
          cacheKey,
          hit: true,
          status: "hit",
          lookupDurationMs,
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
    nonce?: string,
  ): Promise<void> {
    if (!result || result.stream) return;

    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride);
    const now = Date.now();

    const cachedResult = this.cloneResult(result);
    const sealedHtml = sealHtmlNonceForCache(result.html, nonce);
    cachedResult.html = sealedHtml.html;
    for (const [key, variant] of this.variants) {
      if (variant.settled && variant.expiresAt !== undefined && variant.expiresAt < now) {
        this.variants.delete(key);
      }
    }
    const previous = this.variants.get(cacheKey);
    const previousWrite = this.keyWrites.get(cacheKey);
    let evicted: [string, typeof previous] | undefined;
    if (!previous && this.variants.size >= this.maxTrackedVariants) {
      const oldest = this.variants.entries().next().value;
      if (oldest) {
        evicted = oldest;
        this.variants.delete(oldest[0]);
      }
    }
    let eviction: Promise<void> | undefined;
    if (evicted) {
      const [key, variant] = evicted;
      const preceding = this.keyWrites.get(key) ?? variant?.write;
      eviction = Promise.resolve().then(async () => {
        if (preceding) await Promise.allSettled([preceding]);
        await this.store.delete(key);
      });
      this.trackKeyWrite(key, eviction);
    }
    const write = Promise.resolve().then(async () => {
      if (previousWrite) await Promise.allSettled([previousWrite]);
      if (eviction) await eviction;
      await this.store.set(cacheKey, {
        result: cachedResult,
        ...(sealedHtml.placeholder === undefined
          ? {}
          : { htmlNoncePlaceholder: sealedHtml.placeholder }),
        nodeMapEntries: result.nodeMap ? Array.from(result.nodeMap.entries()) : undefined,
        storedAt: now,
        expiresAt: this.ttlMs ? now + this.ttlMs : undefined,
        staleUntil: this.shouldServeStale(ctx) && this.ttlMs && this.staleMs > 0
          ? now + this.ttlMs + this.staleMs
          : undefined,
      });
    });
    const variant = {
      slugKey: createCacheKey(ctx, `page:${slug}`),
      expiresAt: this.ttlMs
        ? now + this.ttlMs + (this.shouldServeStale(ctx) ? this.staleMs : 0)
        : undefined,
      settled: false,
      write,
    };
    this.variants.delete(cacheKey);
    this.variants.set(cacheKey, variant);
    this.pendingWrites.add(write);
    this.trackKeyWrite(cacheKey, write);
    try {
      await write;
      variant.settled = true;
    } catch (error) {
      if (this.variants.get(cacheKey) === variant) {
        if (previous?.settled) this.variants.set(cacheKey, previous);
        else this.variants.delete(cacheKey);
      }
      throw error;
    } finally {
      this.pendingWrites.delete(write);
    }

    logger.debug("Cached result", {
      slug,
      projectId: ctx.projectId,
      environment: ctx.environment,
      cacheKey,
    });
  }

  async clearForContext(ctx: RenderContext): Promise<void> {
    const startTime = Date.now();
    await this.clearTrackedVariants((key) => key.startsWith(`${ctx.cachePrefix}:`));

    if (!this.store.deleteByPrefix) {
      logger.warn("Store does not support prefix deletion", {
        projectId: ctx.projectId,
        cachePrefix: ctx.cachePrefix,
      });
      return;
    }

    logger.debug("Clearing cache for context", {
      projectId: ctx.projectId,
      environment: ctx.environment,
      cachePrefix: ctx.cachePrefix,
    });

    const deleted = await this.store.deleteByPrefix(ctx.cachePrefix);

    logger.debug("✓ Cleared cache for context", {
      projectId: ctx.projectId,
      entriesDeleted: deleted,
      durationMs: Date.now() - startTime,
    });
  }

  async clearForProject(projectId: string): Promise<void> {
    const startTime = Date.now();
    const prefix = `${projectId}:`;
    await this.clearTrackedVariants((key) => key.startsWith(prefix));

    if (!this.store.deleteByPrefix) {
      logger.warn("Store does not support prefix deletion", { projectId });
      return;
    }

    logger.debug("Clearing cache for project", { projectId, prefix });

    const deleted = await this.store.deleteByPrefix(prefix);

    logger.debug("✓ Cleared cache for project", {
      projectId,
      entriesDeleted: deleted,
      durationMs: Date.now() - startTime,
    });
  }

  async clearSlug(slug: string, ctx: RenderContext): Promise<void> {
    const slugKey = createCacheKey(ctx, `page:${slug}`);
    await this.clearTrackedVariants((_key, trackedSlug) => trackedSlug === slugKey);
    if (this.store.deleteByPrefix) {
      const prefix = slugKey;
      await this.store.deleteByPrefix(prefix);
      logger.debug("Cleared slug from cache by prefix", {
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

    logger.debug("Cleared slug from cache (all variants)", {
      slug,
      projectId: ctx.projectId,
      keys,
    });
  }

  private trackKeyWrite(key: string, write: Promise<void>): void {
    this.keyWrites.set(key, write);
    const retire = () => {
      if (this.keyWrites.get(key) === write) this.keyWrites.delete(key);
    };
    // Callers retain each operation's rejection; this continuation only retires ordering state.
    void write.then(retire, retire);
  }

  private async clearTrackedVariants(
    matches: (key: string, slugKey: string) => boolean,
  ): Promise<void> {
    await Promise.allSettled([...this.pendingWrites]);
    const variants = [...this.variants].filter(([key, variant]) => matches(key, variant.slugKey));
    // Each caller owns its write failure; settlement here only orders invalidation.
    await Promise.allSettled(variants.map(([, variant]) => variant.write));
    for (const [key, variant] of variants) {
      await this.store.delete(key);
      if (this.variants.get(key) === variant) this.variants.delete(key);
    }
  }

  async clearAll(): Promise<void> {
    await Promise.allSettled([...this.pendingWrites]);
    await this.store.clear();
    this.variants.clear();
    logger.debug("Cleared all cached data");
  }

  async destroy(): Promise<void> {
    await Promise.allSettled([...this.pendingWrites]);
    await this.store.destroy();
    this.variants.clear();
  }

  getStats(): { size: number } {
    const stats = this.store.getStats?.();
    if (stats) return stats;
    if (this.store.size) return { size: this.store.size() };
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
    const baseKey = cacheKeyOverride && cacheKeyOverride.length > 0 ? cacheKeyOverride : slug;
    const contentKey = baseKey.startsWith("page:") ? baseKey : `page:${baseKey}`;
    const themedKey = themeKey && !/:theme-(light|dark)$/.test(contentKey)
      ? `${contentKey}${themeKey}`
      : contentKey;
    return createCacheKey(ctx, themedKey);
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() > entry.expiresAt;
  }

  private isStaleUsable(entry: CachePayload, ctx: RenderContext): boolean {
    return this.shouldServeStale(ctx) &&
      typeof entry.staleUntil === "number" &&
      Date.now() <= entry.staleUntil;
  }

  private shouldServeStale(ctx: RenderContext): boolean {
    return ctx.environment === "production" && ctx.mode === "production";
  }

  private cloneResult(
    result: RenderResult,
    nodeMapEntries?: Array<[number, unknown]>,
    htmlNoncePlaceholder?: string,
    nonce?: string,
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
      html: bindHtmlNonceFromCache(result.html, htmlNoncePlaceholder, nonce),
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
    if (result.headers) {
      cloned.headers = { ...result.headers };
    }

    return cloned;
  }
}

function roundDurationMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function recordCacheLookup(status: CacheLookupStatus, durationMs: number): void {
  markRequestProfilePhase("render.cache_lookup", durationMs);
  markRequestProfilePhase(`render.cache_${status}`);
  metrics.recordCacheGet(status === "hit" || status === "stale");
}
