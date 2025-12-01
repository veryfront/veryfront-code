import { rendererLogger as logger } from "@veryfront/utils";
import { NetworkError } from "@veryfront/errors/index.ts";
import { parsePageDataFromHTML } from "./dom-utils.ts";

export type { ComponentMap, FrontmatterData, PageData, RouteData } from "./types.ts";
import type { RouteData } from "./types.ts";

export class PageLoader {
  private cache = new Map<string, RouteData>();

  getCached(path: string): RouteData | undefined {
    return this.cache.get(path);
  }

  isCached(path: string): boolean {
    return this.cache.has(path);
  }

  setCache(path: string, data: RouteData): void {
    this.cache.set(path, data);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async fetchPageData(path: string): Promise<RouteData> {
    const jsonData = await this.tryFetchJSON(path);
    if (jsonData) return jsonData;

    return this.fetchAndParseHTML(path);
  }

  private async tryFetchJSON(path: string): Promise<RouteData | null> {
    try {
      const response = await fetch(`/_veryfront/data${path}.json`, {
        headers: { "X-Veryfront-Navigation": "client" },
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      logger.debug(`[PageLoader] RSC fetch failed for ${path}, falling back to HTML:`, error);
    }

    return null;
  }

  private async fetchAndParseHTML(path: string): Promise<RouteData> {
    const response = await fetch(path, {
      headers: { "X-Veryfront-Navigation": "client" },
    });

    if (!response.ok) {
      throw new NetworkError(`Failed to fetch ${path}`, {
        status: response.status,
        path,
      });
    }

    const html = await response.text();
    const { content, pageData } = parsePageDataFromHTML(html);

    return {
      html: content,
      ...pageData,
    };
  }

  async loadPage(path: string): Promise<RouteData> {
    const cachedData = this.getCached(path);
    if (cachedData) {
      logger.debug(`Loading ${path} from cache`);
      return cachedData;
    }

    const data = await this.fetchPageData(path);
    this.setCache(path, data);

    return data;
  }

  async prefetch(path: string): Promise<void> {
    if (this.isCached(path)) return;

    logger.debug(`Prefetching ${path}`);

    try {
      const data = await this.fetchPageData(path);
      this.setCache(path, data);
    } catch (error) {
      logger.warn(`Failed to prefetch ${path}`, error as Error);
    }
  }
}
