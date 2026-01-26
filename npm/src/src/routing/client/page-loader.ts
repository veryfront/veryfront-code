import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { NetworkError } from "../../errors/index.js";
import { parsePageDataFromHTML } from "./dom-utils.js";

export type {
  ComponentMap,
  FrontmatterData,
  LayoutInfo,
  PageData,
  RouteData,
  SpaPageData,
} from "./types.js";
import type { RouteData, SpaPageData } from "./types.js";

const MAX_CACHE_SIZE = 50;

export class PageLoader {
  private cache = new Map<string, RouteData>();
  private spaCache = new Map<string, SpaPageData>();
  private pendingRequests = new Map<string, Promise<RouteData>>();
  private pendingSpaRequests = new Map<string, Promise<SpaPageData>>();

  private evictIfFull<T>(map: Map<string, T>): void {
    if (map.size < MAX_CACHE_SIZE) return;

    const oldest = map.keys().next().value as string | undefined;
    if (oldest) map.delete(oldest);
  }

  getCached(path: string): RouteData | undefined {
    return this.cache.get(path);
  }

  isCached(path: string): boolean {
    return this.cache.has(path);
  }

  setCache(path: string, data: RouteData): void {
    this.evictIfFull(this.cache);
    this.cache.set(path, data);
  }

  clearCache(): void {
    this.cache.clear();
    this.spaCache.clear();
    this.pendingRequests.clear();
    this.pendingSpaRequests.clear();
  }

  getSpaCached(path: string): SpaPageData | undefined {
    return this.spaCache.get(path);
  }

  isSpaDataCached(path: string): boolean {
    return this.spaCache.has(path);
  }

  setSpaCache(path: string, data: SpaPageData): void {
    this.evictIfFull(this.spaCache);
    this.spaCache.set(path, data);
  }

  async fetchPageData(path: string): Promise<RouteData> {
    const jsonData = await this.tryFetchJSON(path);
    if (jsonData) return jsonData;

    return this.fetchAndParseHTML(path);
  }

  private async tryFetchJSON(path: string): Promise<RouteData | null> {
    try {
      const response = await dntShim.fetch(`/_veryfront/data${path}.json`, {
        headers: { "X-Veryfront-Navigation": "client" },
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      logger.debug(`[Veryfront] JSON fetch failed for ${path}, falling back to HTML:`, error);
      return null;
    }
  }

  private async fetchAndParseHTML(path: string): Promise<RouteData> {
    const response = await dntShim.fetch(path, {
      headers: { "X-Veryfront-Navigation": "client" },
    });

    if (!response.ok) {
      throw new NetworkError(`Failed to fetch ${path}`, { status: response.status, path });
    }

    const html = await response.text();
    const { content, pageData } = parsePageDataFromHTML(html);

    return { html: content, ...pageData };
  }

  loadPage(path: string): Promise<RouteData> {
    const cachedData = this.getCached(path);
    if (cachedData) {
      logger.debug(`[Veryfront] Loading ${path} from cache`);
      return Promise.resolve(cachedData);
    }

    const pending = this.pendingRequests.get(path);
    if (pending) {
      logger.debug(`[Veryfront] Reusing pending request for ${path}`);
      return pending;
    }

    const request = this.createPendingRequest(path, this.pendingRequests, async () => {
      const data = await this.fetchPageData(path);
      this.setCache(path, data);
      return data;
    });

    logger.debug(`[Veryfront] Reusing pending request for ${path}`);
    return request;
  }

  async prefetch(path: string): Promise<void> {
    if (this.isCached(path)) return;

    logger.debug(`[Veryfront] Prefetching ${path}`);

    try {
      const data = await this.fetchPageData(path);
      this.setCache(path, data);
    } catch (error) {
      logger.warn(
        `[Veryfront] Failed to prefetch ${path}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async fetchSpaPageData(path: string): Promise<SpaPageData> {
    const normalizedPath = path === "/" ? "" : path.replace(/^\//, "");
    const endpoint = `/_veryfront/page-data/${normalizedPath}.json`;

    logger.debug(`[Veryfront] Fetching SPA page data from ${endpoint}`);

    const response = await dntShim.fetch(endpoint, {
      headers: { "X-Veryfront-Navigation": "spa" },
    });

    if (!response.ok) {
      throw new NetworkError(`Failed to fetch SPA page data for ${path}`, {
        status: response.status,
        path,
      });
    }

    return await response.json();
  }

  loadSpaPageData(path: string): Promise<SpaPageData> {
    const cachedData = this.getSpaCached(path);
    if (cachedData) {
      logger.debug(`[Veryfront] Loading SPA data for ${path} from cache`);
      return Promise.resolve(cachedData);
    }

    const pending = this.pendingSpaRequests.get(path);
    if (pending) {
      logger.debug(`[Veryfront] Reusing pending SPA request for ${path}`);
      return pending;
    }

    const request = this.createPendingRequest(path, this.pendingSpaRequests, async () => {
      const data = await this.fetchSpaPageData(path);
      this.setSpaCache(path, data);
      return data;
    });

    logger.debug(`[Veryfront] Reusing pending SPA request for ${path}`);
    return request;
  }

  async prefetchSpaPageData(path: string): Promise<void> {
    if (this.isSpaDataCached(path)) return;

    logger.debug(`[Veryfront] Prefetching SPA page data for ${path}`);

    try {
      const data = await this.fetchSpaPageData(path);
      this.setSpaCache(path, data);
    } catch (error) {
      logger.warn(
        `[Veryfront] Failed to prefetch SPA data for ${path}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private createPendingRequest<T>(
    path: string,
    pendingMap: Map<string, Promise<T>>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const request = (async () => {
      try {
        return await fetcher();
      } finally {
        pendingMap.delete(path);
      }
    })();

    pendingMap.set(path, request);
    return request;
  }
}
