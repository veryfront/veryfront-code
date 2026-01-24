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
  private ttlMs?: number;

  constructor(options: CacheCoordinatorOptions = {}) {
    this.ttlMs = options.ttlMs;
    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries,
        ttlMs: options.memory?.ttlMs ?? options.ttlMs,
      });
  }

  checkCache(slug: string): Promise<CacheLookupResult> {
    return withSpan(
      "cache.checkCache",
      async () => {
        const cached = await this.store.get(slug);

        if (!cached) {
          return { depAwareSlug: slug, moduleCacheKey: slug };
        }

        if (this.isExpired(cached)) {
          await this.store.delete(slug);
          return { depAwareSlug: slug, moduleCacheKey: slug };
        }

        return {
          cachedResult: cached.result,
          depAwareSlug: slug,
          moduleCacheKey: slug,
          cachedModule: cached.result.pageModule,
        };
      },
      { "cache.slug": slug },
    );
  }

  persistResult(result: RenderResult, slug: string): Promise<void> {
    return withSpan(
      "cache.persistResult",
      async () => {
        if (result.stream) {
          return;
        }

        const now = Date.now();
        const payload: CachePayload = {
          result: {
            html: result.html,
            css: result.css,
            frontmatter: result.frontmatter,
            headings: result.headings,
            nodeMap: result.nodeMap,
            stream: null,
            ssrHash: result.ssrHash,
            pageModule: result.pageModule,
          },
          storedAt: now,
          expiresAt: this.ttlMs ? now + this.ttlMs : undefined,
        };

        await this.store.set(slug, payload);
      },
      { "cache.slug": slug },
    );
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
  }

  async clearSlug(slug: string): Promise<void> {
    await this.store.delete(slug);
  }

  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() > entry.expiresAt;
  }
}
