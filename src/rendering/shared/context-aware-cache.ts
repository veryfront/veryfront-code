import { hashString } from "#veryfront/cache/hash.ts";
import { rendererLogger } from "#veryfront/utils";
import { markRequestProfilePhase, metrics, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import {
  CACHE_ALIAS_EPOCH_KEY,
  CACHE_ALIAS_KEY_PREFIX,
  type CachePayload,
  type CacheStore,
} from "../cache/types.ts";
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
  /** Runtime/pinning-scoped entries need deleteByPrefix for shared invalidation. */
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

function isScopedOverride(key?: string): boolean {
  return Boolean(key && /(?:^|:)(?:react-runtime:|pins:|render-identity:hash-)/.test(key));
}

function scopedSlugPrefix(slug: string): string {
  const digest = `${hashString(`render-slug:a:${slug}`)}-${hashString(`render-slug:b:${slug}`)}`;
  return `render-variants:v1:${digest}:`;
}

// Serialize legacy alias control operations within a process, including separate
// handles for one context. Stored generations provide invalidation across restarts.
const aliasGenerationOperations = new Map<string, { settled: Promise<void> }>();
async function withAliasGeneration<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = aliasGenerationOperations.get(key)?.settled ?? Promise.resolve();
  const operation = (async () => {
    await previous;
    return await action();
  })();
  const entry = { settled: operation.then(() => {}, () => {}) };
  aliasGenerationOperations.set(key, entry);
  try {
    return await operation;
  } finally {
    if (aliasGenerationOperations.get(key) === entry) aliasGenerationOperations.delete(key);
  }
}

export class ContextAwareCacheCoordinator {
  private store: CacheStore;
  private ttlMs: number | undefined;
  private staleMs: number;
  private readonly defaultTtlMs = DEFAULT_CACHE_TTL_MS;
  // Track only writes in flight, not cached entries: eviction belongs to the store.
  private readonly writes = new Map<string, { slugKey: string; write: Promise<void> }>();
  private invalidationBarrier: Promise<void> = Promise.resolve();
  private destroyed = false;
  private readonly legacyKeys = new Map<string, string>();
  private readonly maxLegacyKeys: number;
  private legacyWriteBarrier: Promise<void> = Promise.resolve();
  private readonly aliasEpochKeys = new Set<string>();

  constructor(options: ContextAwareCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.staleMs = options.staleMs ?? DEFAULT_CACHE_STALE_MS;
    const legacyLimit = options.memory?.maxEntries;
    this.maxLegacyKeys =
      typeof legacyLimit === "number" && Number.isSafeInteger(legacyLimit) && legacyLimit > 0
        ? legacyLimit
        : DEFAULT_MAX_ENTRIES;
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
    cacheKeyKind: "route" | "alias" = isScopedOverride(cacheKeyOverride) ? "route" : "alias",
  ): Promise<ContextAwareCacheLookupResult> {
    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride, cacheKeyKind);
    if (isScopedOverride(cacheKeyOverride) && !this.store.deleteByPrefix) {
      return Promise.resolve({ cacheKey, hit: false, status: "miss", lookupDurationMs: 0 });
    }

    return withSpan(
      SpanNames.CACHE_CHECK_SPECULATIVE,
      async () => {
        const lookupStart = performance.now();
        const cached = (await this.store.get(cacheKey)) as CachePayload | undefined;

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

        if (
          cached.aliasEpoch !== undefined ||
          (!this.store.deleteByPrefix && cacheKeyOverride &&
            !isScopedOverride(cacheKeyOverride))
        ) {
          const epoch = await this.store.get(this.aliasEpochKey(ctx));
          if (
            typeof cached.aliasEpoch !== "string" || cached.aliasEpoch !== epoch?.aliasEpoch ||
            (epoch && this.isExpired(epoch))
          ) {
            const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
            recordCacheLookup("miss", lookupDurationMs);
            return { cacheKey, hit: false, status: "miss", lookupDurationMs };
          }
        }

        const trackedSlug = this.legacyKeys.get(cacheKey);
        if (trackedSlug !== undefined) {
          this.legacyKeys.delete(cacheKey);
          if (!this.isExpired(cached) || this.isStaleUsable(cached, ctx)) {
            this.legacyKeys.set(cacheKey, trackedSlug);
          }
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
    cacheKeyKind: "route" | "alias" = isScopedOverride(cacheKeyOverride) ? "route" : "alias",
  ): Promise<void> {
    if (!result || result.stream || this.destroyed) return;
    // Scoped entries require store-level prefix deletion, including across
    // coordinators/restarts. An unsupported store remains usable for legacy keys.
    if (isScopedOverride(cacheKeyOverride) && !this.store.deleteByPrefix) return;

    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride, cacheKeyKind);
    const now = Date.now();

    const cachedResult = this.cloneResult(result);
    const sealedHtml = sealHtmlNonceForCache(result.html, nonce);
    cachedResult.html = sealedHtml.html;
    const previous = this.writes.get(cacheKey)?.write;
    const barrier = this.invalidationBarrier;
    const legacyWrite = !this.store.deleteByPrefix ? this.legacyWriteBarrier : undefined;
    const write = (async () => {
      // Prior operations report their errors to their own callers. Settlement
      // establishes ordering without making a failed write poison later writes.
      await Promise.allSettled([
        barrier,
        ...(previous ? [previous] : []),
        ...(legacyWrite ? [legacyWrite] : []),
      ]);
      if (!this.store.deleteByPrefix && !this.legacyKeys.has(cacheKey)) {
        while (this.legacyKeys.size >= this.maxLegacyKeys) {
          const oldest = this.legacyKeys.keys().next().value;
          if (oldest === undefined) break;
          await this.store.delete(oldest);
          this.legacyKeys.delete(oldest);
        }
      }
      const aliasEpoch = !this.store.deleteByPrefix && cacheKeyOverride &&
          !isScopedOverride(cacheKeyOverride)
        ? await this.captureAliasEpoch(ctx)
        : undefined;
      await this.store.set(cacheKey, {
        ...(aliasEpoch ? { aliasEpoch } : {}),
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
      if (!this.store.deleteByPrefix) {
        this.legacyKeys.set(cacheKey, createCacheKey(ctx, `page:${slug}`));
      }
    })();
    if (!this.store.deleteByPrefix) this.legacyWriteBarrier = write.then(() => {}, () => {});
    const entry = { slugKey: createCacheKey(ctx, `page:${slug}`), write };
    this.writes.set(cacheKey, entry);
    try {
      await write;
    } finally {
      if (this.writes.get(cacheKey) === entry) this.writes.delete(cacheKey);
    }

    logger.debug("Cached result", {
      slug,
      projectId: ctx.projectId,
      environment: ctx.environment,
      cacheKey,
    });
  }

  private aliasEpochKey(ctx: RenderContext): string {
    return createCacheKey(ctx, CACHE_ALIAS_EPOCH_KEY);
  }

  private captureAliasEpoch(ctx: RenderContext): Promise<string> {
    return withAliasGeneration(this.aliasEpochKey(ctx), () => this.initializeAliasEpoch(ctx));
  }

  private async initializeAliasEpoch(ctx: RenderContext): Promise<string> {
    const key = this.aliasEpochKey(ctx);
    const existing = await this.store.get(key);
    const valid = typeof existing?.aliasEpoch === "string" && !this.isExpired(existing);
    const token = valid ? existing.aliasEpoch! : crypto.randomUUID();
    if (!this.store.deleteByPrefix && !this.aliasEpochKeys.has(key)) {
      while (this.aliasEpochKeys.size >= this.maxLegacyKeys) {
        const oldest = this.aliasEpochKeys.values().next().value;
        if (oldest === undefined) break;
        await this.store.delete(oldest);
        this.aliasEpochKeys.delete(oldest);
      }
      this.aliasEpochKeys.add(key);
    }
    if (!valid) {
      await this.store.set(key, {
        aliasEpoch: token,
        storedAt: Date.now(),
        ...(this.ttlMs ? { expiresAt: Date.now() + this.ttlMs + Math.max(0, this.staleMs) } : {}),
        result: { html: "", frontmatter: {}, stream: null },
      });
    }
    return token;
  }

  private revokeAliasEpoch(ctx: RenderContext): Promise<void> {
    const key = this.aliasEpochKey(ctx);
    return withAliasGeneration(key, async () => {
      const epoch = await this.store.get(key);
      if (typeof epoch?.aliasEpoch === "string") await this.store.delete(key);
      this.aliasEpochKeys.delete(key);
    });
  }

  private async deleteAliasEpochs(matches: (key: string) => boolean): Promise<void> {
    const results = await Promise.allSettled(
      [...this.aliasEpochKeys].filter(matches).map(async (key) => {
        await this.store.delete(key);
        this.aliasEpochKeys.delete(key);
      }),
    );
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Alias epoch invalidation failed");
  }

  clearForContext(ctx: RenderContext): Promise<void> {
    const prefix = `${ctx.cachePrefix}:`;
    return this.invalidate((key) => key.startsWith(prefix), async () => {
      if (this.store.deleteByPrefix) await this.store.deleteByPrefix(prefix);
      else {
        const results = await Promise.allSettled([
          this.deleteLegacyKeys((key) => key.startsWith(prefix)),
          this.revokeAliasEpoch(ctx),
        ]);
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        if (errors.length) throw new AggregateError(errors, "Cache invalidation failed");
      }
    });
  }

  clearForProject(projectId: string): Promise<void> {
    const prefix = `${projectId}:`;
    return this.invalidate((key) => key.startsWith(prefix), async () => {
      if (this.store.deleteByPrefix) await this.store.deleteByPrefix(prefix);
      else {
        const results = await Promise.allSettled([
          this.deleteLegacyKeys((key) => key.startsWith(prefix)),
          this.deleteAliasEpochs((key) => key.startsWith(prefix)),
        ]);
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        if (errors.length) throw new AggregateError(errors, "Cache invalidation failed");
      }
    });
  }

  clearSlug(slug: string, ctx: RenderContext): Promise<void> {
    const slugKey = createCacheKey(ctx, `page:${slug}`);
    // Alias keys intentionally erase route identity. Drain this context before
    // revoking its alias generation so pending writes cannot restore old data.
    return this.invalidate((key) => key.startsWith(`${ctx.cachePrefix}:`), async () => {
      const deletions = [slugKey, `${slugKey}:theme-light`, `${slugKey}:theme-dark`]
        .map((key) => Promise.resolve().then(() => this.store.delete(key)));
      if (!this.store.deleteByPrefix) deletions.push(this.revokeAliasEpoch(ctx));
      if (this.store.deleteByPrefix) {
        deletions.push(
          Promise.resolve().then(() =>
            this.store.deleteByPrefix!(createCacheKey(ctx, CACHE_ALIAS_KEY_PREFIX))
          ).then(() => {}),
        );
        deletions.push(
          Promise.resolve().then(() => this.store.deleteByPrefix!(`${slugKey}:`)).then(() => {}),
        );
        deletions.push(
          Promise.resolve().then(() => this.store.deleteByPrefix!(`${slugKey}?`)).then(() => {}),
        );
        deletions.push(
          Promise.resolve().then(() =>
            this.store.deleteByPrefix!(createCacheKey(ctx, scopedSlugPrefix(slug)))
          ).then(() => {}),
        );
      }
      if (!this.store.deleteByPrefix) {
        deletions.push(this.deleteLegacyKeys((_key, trackedSlug) => trackedSlug === slugKey));
      }
      const settled = await Promise.allSettled(deletions);
      const errors = settled.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (errors.length) throw new AggregateError(errors, "Cache slug invalidation failed");
    });
  }

  private async deleteLegacyKeys(
    matches: (key: string, slugKey: string) => boolean,
  ): Promise<void> {
    const entries = [...this.legacyKeys].filter(([key, slugKey]) => matches(key, slugKey));
    const settled = await Promise.allSettled(entries.map(async ([key, slugKey]) => {
      await this.store.delete(key);
      if (this.legacyKeys.get(key) === slugKey) this.legacyKeys.delete(key);
    }));
    const errors = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Legacy cache invalidation failed");
  }

  private invalidate(
    matches: (key: string, slugKey: string) => boolean,
    clear: () => Promise<void>,
  ): Promise<void> {
    const writes = [...this.writes].filter(([key, entry]) => matches(key, entry.slugKey))
      .map(([, entry]) => entry.write);
    const previous = this.invalidationBarrier;
    const operation = (async () => {
      await previous;
      const settled = await Promise.allSettled(writes);
      const errors = settled.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      try {
        await clear();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, "Cache invalidation failed");
    })();
    // Future writes wait for deletion, but receive only their own storage errors.
    this.invalidationBarrier = operation.then(() => {}, () => {});
    return operation;
  }

  clearAll(): Promise<void> {
    return this.invalidate(() => true, async () => {
      await this.store.clear();
      this.legacyKeys.clear();
      this.aliasEpochKeys.clear();
    });
  }

  destroy(): Promise<void> {
    this.destroyed = true;
    return this.invalidate(() => true, async () => {
      await this.store.destroy();
      this.legacyKeys.clear();
      this.aliasEpochKeys.clear();
    });
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
    cacheKeyKind: "route" | "alias" = isScopedOverride(cacheKeyOverride) ? "route" : "alias",
  ): string {
    // Use hyphen instead of equals sign (API cache key validation only allows: a-z A-Z 0-9 _ : . * - /)
    const themeKey = colorScheme ? `:theme-${colorScheme}` : "";
    if (
      isScopedOverride(cacheKeyOverride) && cacheKeyKind === "route"
    ) {
      const identity = `${cacheKeyOverride}:${colorScheme ?? "default"}`;
      const digest = `${hashString(`render-variant:a:${identity}`)}-${
        hashString(`render-variant:b:${identity}`)
      }`;
      return createCacheKey(ctx, `${scopedSlugPrefix(slug)}${digest}${themeKey}`);
    }
    const baseKey = cacheKeyOverride && cacheKeyOverride.length > 0 ? cacheKeyOverride : slug;
    const contentKey = baseKey.startsWith("page:") ? baseKey : `page:${baseKey}`;
    const themedKey = themeKey && !/:theme-(light|dark)$/.test(contentKey)
      ? `${contentKey}${themeKey}`
      : contentKey;
    if (cacheKeyOverride && cacheKeyKind === "alias") {
      const digest = `${hashString(`render-alias:a:${themedKey}`)}-${
        hashString(`render-alias:b:${themedKey}`)
      }`;
      const suffix = themedKey.match(/:theme-(light|dark)$/)?.[0] ?? "";
      return createCacheKey(ctx, `${CACHE_ALIAS_KEY_PREFIX}${digest}${suffix}`);
    }
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
