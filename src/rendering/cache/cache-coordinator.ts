import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload, CacheStore } from "./types.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "./stores/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export interface CacheCoordinatorOptions {
  store?: CacheStore;
  memory?: MemoryCacheStoreOptions;
  ttlMs?: number;
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

  constructor(options: CacheCoordinatorOptions = {}) {
    this.ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries,
        ttlMs: options.memory?.ttlMs ?? this.ttlMs,
      });
  }

  checkCache(slug: string, cacheKey?: string): Promise<CacheLookupResult> {
    return withSpan(
      "cache.checkCache",
      async () => {
        const key = cacheKey ?? slug;
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
      { "cache.slug": slug, "cache.key": cacheKey ?? slug },
    );
  }

  persistResult(result: RenderResult, slug: string, cacheKey?: string): Promise<void> {
    return withSpan(
      "cache.persistResult",
      async () => {
        if (result.stream) return;

        const key = cacheKey ?? slug;
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
      { "cache.slug": slug, "cache.key": cacheKey ?? slug },
    );
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
  }

  async clearSlug(slug: string): Promise<void> {
    if (this.store.deleteByPrefix) {
      await this.store.deleteByPrefix(slug);
      return;
    }
    await this.store.delete(slug);
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
