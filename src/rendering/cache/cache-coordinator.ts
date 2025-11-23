import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload, CacheStore } from "./types.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "./stores/index.ts";

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

  async checkCache(
    slug: string,
    _pageInfo: unknown,
    _layoutBundle: unknown,
    _nestedLayouts: unknown,
    _providerInfos: unknown,
  ): Promise<CacheLookupResult> {
    const cached = await this.store.get(slug);

    if (cached && !this.isExpired(cached)) {
      return {
        cachedResult: this.cloneResult(cached.result),
        depAwareSlug: slug,
        moduleCacheKey: slug,
        cachedModule: cached.result.pageModule,
      };
    }

    if (cached) {
      await this.store.delete(slug);
    }

    return {
      depAwareSlug: slug,
      moduleCacheKey: slug,
    };
  }

  async persistResult(
    result: RenderResult,
    slug: string,
    _depAwareSlug: string,
    _moduleCacheKey: string,
    _pageInfo: unknown,
    _clientModuleCode: string | undefined,
    _pageModuleType: unknown,
    _cachedModule: RenderResult["pageModule"] | undefined,
  ): Promise<void> {
    if (!result || result.stream) {
      return;
    }

    const payload: CachePayload = {
      result: this.cloneResult(result),
      storedAt: Date.now(),
      expiresAt: this.ttlMs ? Date.now() + this.ttlMs : undefined,
    };

    await this.store.set(slug, payload);
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
