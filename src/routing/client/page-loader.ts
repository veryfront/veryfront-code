import { rendererLogger } from "#veryfront/utils";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { parsePageDataFromHTML, resolveInternalNavigationUrl } from "./dom-utils.ts";

export type {
  ComponentMap,
  FrontmatterData,
  LayoutInfo,
  PageData,
  RouteData,
  SpaPageData,
} from "./types.ts";
import type { RouteData, SpaPageData } from "./types.ts";

const logger = rendererLogger.component("veryfront");

const MAX_CACHE_SIZE = 50;
const MAX_PENDING_REQUESTS = 100;
const MAX_PAGE_RESPONSE_BYTES = 8 * 1024 * 1024;

function requireInternalNavigationUrl(path: string): URL {
  const url = resolveInternalNavigationUrl(path);
  if (!url) throw new TypeError("Navigation URL must stay on the current origin");
  return url;
}

async function readPageResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      await response.body?.cancel().catch(() => {});
      throw new TypeError("Page response Content-Length is invalid");
    }
    if (Number(contentLength) > MAX_PAGE_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new RangeError("Page response exceeded the configured size limit");
    }
  }

  const body = await readResponseTextPrefix(response, MAX_PAGE_RESPONSE_BYTES + 1);
  if (body.truncated) throw new RangeError("Page response exceeded the configured size limit");
  return body.text;
}

export class PageLoader {
  private cache = new Map<string, RouteData>();
  private spaCache = new Map<string, SpaPageData>();
  private pendingRequests = new Map<string, Promise<RouteData>>();
  private pendingSpaRequests = new Map<string, Promise<SpaPageData>>();

  private evictIfFull<T>(map: Map<string, T>, key: string): void {
    if (map.has(key) || map.size < MAX_CACHE_SIZE) return;

    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }

  getCached(path: string): RouteData | undefined {
    return this.cache.get(path);
  }

  isCached(path: string): boolean {
    return this.cache.has(path);
  }

  setCache(path: string, data: RouteData): void {
    this.evictIfFull(this.cache, path);
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
    this.evictIfFull(this.spaCache, path);
    this.spaCache.set(path, data);
  }

  async fetchPageData(path: string): Promise<RouteData> {
    const navigationUrl = requireInternalNavigationUrl(path);
    return (await this.tryFetchJSON(navigationUrl)) ?? this.fetchAndParseHTML(navigationUrl);
  }

  private async tryFetchJSON(navigationUrl: URL): Promise<RouteData | null> {
    try {
      const dataPath = navigationUrl.pathname === "/" ? "/index" : navigationUrl.pathname;
      const response = await fetch(`/_veryfront/data${dataPath}.json${navigationUrl.search}`, {
        headers: { "X-Veryfront-Navigation": "client" },
      });

      if (!response.ok) return null;
      return JSON.parse(await readPageResponse(response)) as RouteData;
    } catch (error) {
      logger.debug("JSON page-data fetch failed, falling back to HTML", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  }

  private async fetchAndParseHTML(navigationUrl: URL): Promise<RouteData> {
    const response = await fetch(`${navigationUrl.pathname}${navigationUrl.search}`, {
      headers: { "X-Veryfront-Navigation": "client" },
    });

    if (!response.ok) {
      throw NETWORK_ERROR.create({
        detail: "Failed to fetch page",
        status: response.status,
      });
    }

    const html = await readPageResponse(response);
    const { content, pageData } = parsePageDataFromHTML(html);

    return { html: content, ...pageData };
  }

  loadPage(path: string): Promise<RouteData> {
    const cachedData = this.getCached(path);
    if (cachedData) {
      logger.debug("Loading page from cache");
      return Promise.resolve(cachedData);
    }

    const pending = this.pendingRequests.get(path);
    if (pending) {
      logger.debug("Reusing pending page request");
      return pending;
    }

    logger.debug("Creating pending page request");

    return this.createPendingRequest(path, this.pendingRequests, async () => {
      const data = await this.fetchPageData(path);
      this.setCache(path, data);
      return data;
    });
  }

  async prefetch(path: string): Promise<void> {
    if (this.isCached(path)) return;

    logger.debug("Prefetching page");

    try {
      await this.loadPage(path);
    } catch (error) {
      logger.warn("[Veryfront] Failed to prefetch page", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  async fetchSpaPageData(path: string): Promise<SpaPageData> {
    const navigationUrl = requireInternalNavigationUrl(path);
    const normalizedPath = navigationUrl.pathname === "/"
      ? "index"
      : navigationUrl.pathname.replace(/^\//, "");
    const endpoint = `/_veryfront/page-data/${normalizedPath}.json${navigationUrl.search}`;

    logger.debug("Fetching SPA page data");

    const response = await fetch(endpoint, {
      headers: { "X-Veryfront-Navigation": "spa" },
    });

    if (!response.ok) {
      throw NETWORK_ERROR.create({
        detail: "Failed to fetch SPA page data",
        status: response.status,
      });
    }

    return JSON.parse(await readPageResponse(response)) as SpaPageData;
  }

  loadSpaPageData(path: string): Promise<SpaPageData> {
    const cachedData = this.getSpaCached(path);
    if (cachedData) {
      logger.debug("Loading SPA page data from cache");
      return Promise.resolve(cachedData);
    }

    const pending = this.pendingSpaRequests.get(path);
    if (pending) {
      logger.debug("Reusing pending SPA page-data request");
      return pending;
    }

    logger.debug("Creating pending SPA page-data request");

    return this.createPendingRequest(path, this.pendingSpaRequests, async () => {
      const data = await this.fetchSpaPageData(path);
      this.setSpaCache(path, data);
      return data;
    });
  }

  async prefetchSpaPageData(path: string): Promise<void> {
    if (this.isSpaDataCached(path)) return;

    logger.debug("Prefetching SPA page data");

    try {
      await this.loadSpaPageData(path);
    } catch (error) {
      logger.warn("[Veryfront] Failed to prefetch SPA page data", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  private createPendingRequest<T>(
    path: string,
    pendingMap: Map<string, Promise<T>>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    if (pendingMap.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new RangeError("Too many page requests are pending"));
    }

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
