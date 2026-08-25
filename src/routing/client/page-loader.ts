import { rendererLogger } from "#veryfront/utils";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry.ts";
import { isFullHTMLDocument } from "#veryfront/html/html-detection.ts";
import { parsePageDataFromHTML, routeRequiresDocumentNavigation } from "./dom-utils.ts";
import {
  findServerHydrationDataElement,
  type HydrationDataDocumentLike,
} from "#veryfront/html/hydration-data-element.ts";

export type {
  ClientRouteHeadEntry,
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
const DEPENDENCY_PINNING_RESPONSE_HEADER = "x-veryfront-dependency-pins";

type HydrationDocument = HydrationDataDocumentLike;
type DocumentReloader = (url: string) => void;

function reloadBrowserDocument(url: string): void {
  if (typeof globalThis.location !== "undefined") {
    globalThis.location.assign(url);
  }
}

function readDependencyPinningCacheKey(doc?: HydrationDocument): string {
  if (!doc) return "off";

  try {
    const hydrationDataElement = findServerHydrationDataElement(doc);
    if (!hydrationDataElement?.textContent) return "off";

    const hydrationData = JSON.parse(hydrationDataElement.textContent) as {
      dependencyPinningCacheKey?: unknown;
    };
    return typeof hydrationData.dependencyPinningCacheKey === "string" &&
        hydrationData.dependencyPinningCacheKey.startsWith("on:")
      ? hydrationData.dependencyPinningCacheKey
      : "off";
  } catch (error) {
    logger.debug("Failed to read dependency snapshot from hydration data:", error);
    return "off";
  }
}

export class PageLoader {
  private cache = new Map<string, RouteData>();
  private spaCache = new Map<string, SpaPageData>();
  private pendingRequests = new Map<string, Promise<RouteData>>();
  private pendingSpaRequests = new Map<string, Promise<SpaPageData>>();
  /**
   * A loader belongs to the dependency snapshot of the document that created it.
   * Keeping this immutable also prevents cached or in-flight route data from
   * crossing snapshot boundaries if the hydration element is later replaced.
   */
  private readonly dependencyPinningCacheKey: string;
  private readonly reloadDocument: DocumentReloader;
  private snapshotRecoveryStarted = false;

  constructor(
    doc: HydrationDocument | undefined = typeof document === "undefined" ? undefined : document,
    reloadDocument: DocumentReloader = reloadBrowserDocument,
  ) {
    this.dependencyPinningCacheKey = readDependencyPinningCacheKey(doc);
    this.reloadDocument = reloadDocument;
  }

  private evictIfFull<T>(map: Map<string, T>): void {
    if (map.size < MAX_CACHE_SIZE) return;

    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }

  getCached(path: string): RouteData | undefined {
    return this.cache.get(this.snapshotScopedPath(path));
  }

  isCached(path: string): boolean {
    return this.cache.has(this.snapshotScopedPath(path));
  }

  setCache(path: string, data: RouteData): void {
    this.evictIfFull(this.cache);
    this.cache.set(this.snapshotScopedPath(path), data);
  }

  clearCache(): void {
    this.cache.clear();
    this.spaCache.clear();
    this.pendingRequests.clear();
    this.pendingSpaRequests.clear();
  }

  getSpaCached(path: string): SpaPageData | undefined {
    return this.spaCache.get(this.snapshotScopedPath(path));
  }

  isSpaDataCached(path: string): boolean {
    return this.spaCache.has(this.snapshotScopedPath(path));
  }

  setSpaCache(path: string, data: SpaPageData): void {
    this.evictIfFull(this.spaCache);
    this.spaCache.set(this.snapshotScopedPath(path), data);
  }

  async fetchPageData(
    path: string,
    reloadOnSnapshotFailure = true,
  ): Promise<RouteData> {
    try {
      return (await this.tryFetchJSON(path)) ?? await this.fetchAndParseHTML(path);
    } catch (error) {
      this.recoverSnapshotFailure(error, path, reloadOnSnapshotFailure);
      throw error;
    }
  }

  private async tryFetchJSON(path: string): Promise<RouteData | null> {
    let response: Response;
    try {
      const navigationUrl = new URL(path, "http://veryfront.local");
      const dataPath = navigationUrl.pathname === "/" ? "/index" : navigationUrl.pathname;
      const endpoint = `/_veryfront/data${dataPath}.json${navigationUrl.search}`;
      response = await fetch(endpoint, {
        headers: this.navigationHeaders("client"),
      });
    } catch (error) {
      logger.debug(`JSON fetch failed for ${path}, falling back to HTML:`, error);
      return null;
    }

    if (response.status === 409) {
      this.failDependencySnapshot(
        path,
        `Dependency snapshot is unavailable for ${path}`,
      );
    }
    if (!response.ok) return null;

    let data: RouteData;
    try {
      data = await response.json() as RouteData;
    } catch (error) {
      logger.debug(`JSON response was invalid for ${path}, falling back to HTML:`, error);
      return null;
    }
    this.assertDependencySnapshot(
      data.dependencyPinningCacheKey,
      path,
      "route data",
    );
    if (typeof data.html === "string" && isFullHTMLDocument(data.html)) {
      const parsed = parsePageDataFromHTML(data.html);
      this.assertDependencySnapshot(
        parsed.dependencyPinningCacheKey,
        path,
        "route data HTML body",
      );
      return {
        ...parsed.pageData,
        ...data,
        html: parsed.content,
        managedHead: parsed.managedHead,
      };
    }
    // Only the HTML path can inspect a parsed document for scripts. A route-data
    // fragment carries them inline (structured data, analytics), so it is
    // classified here rather than failing later in the soft transition.
    return routeRequiresDocumentNavigation(data)
      ? { ...data, requiresFullDocumentNavigation: true }
      : data;
  }

  private async fetchAndParseHTML(path: string): Promise<RouteData> {
    const response = await fetch(path, {
      headers: this.navigationHeaders("client"),
    });

    if (response.status === 409) {
      this.failDependencySnapshot(
        path,
        `Dependency snapshot is unavailable for ${path}`,
      );
    }
    if (!response.ok) {
      throw NETWORK_ERROR.create({
        detail: `Failed to fetch ${path}`,
        status: response.status,
        context: { path },
      });
    }
    this.assertDependencySnapshot(
      response.headers.get(DEPENDENCY_PINNING_RESPONSE_HEADER),
      path,
      "HTML response",
    );

    const html = await response.text();
    const {
      content,
      pageData,
      managedHead,
      dependencyPinningCacheKey,
    } = parsePageDataFromHTML(html);
    this.assertDependencySnapshot(
      dependencyPinningCacheKey,
      path,
      "HTML body",
    );

    return { ...pageData, html: content, managedHead };
  }

  loadPage(path: string): Promise<RouteData> {
    return this.loadPageWithSnapshotRecovery(path, true);
  }

  private loadPageWithSnapshotRecovery(
    path: string,
    reloadOnSnapshotFailure: boolean,
  ): Promise<RouteData> {
    const cachedData = this.getCached(path);
    if (cachedData) {
      logger.debug(`Loading ${path} from cache`);
      return Promise.resolve(cachedData);
    }

    const pendingKey = this.snapshotScopedPath(path);
    const pending = this.pendingRequests.get(pendingKey);
    if (pending) {
      logger.debug(`Reusing pending request for ${path}`);
      return this.withSnapshotRecovery(
        pending,
        path,
        reloadOnSnapshotFailure,
      );
    }

    logger.debug(`Creating pending request for ${path}`);

    const request = this.createPendingRequest(pendingKey, this.pendingRequests, async () => {
      const data = await this.fetchPageData(path, false);
      this.setCache(path, data);
      return data;
    });
    return this.withSnapshotRecovery(
      request,
      path,
      reloadOnSnapshotFailure,
    );
  }

  async prefetch(path: string): Promise<void> {
    if (this.isCached(path)) return;

    logger.debug(`Prefetching ${path}`);

    try {
      await this.loadPageWithSnapshotRecovery(path, false);
    } catch (error) {
      logger.warn(
        `[Veryfront] Failed to prefetch ${path}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async fetchSpaPageData(
    path: string,
    reloadOnSnapshotFailure = true,
  ): Promise<SpaPageData> {
    try {
      const navigationUrl = new URL(path, "http://veryfront.local");
      const normalizedPath = navigationUrl.pathname === "/"
        ? "index"
        : navigationUrl.pathname.replace(/^\//, "");
      const endpoint = `/_veryfront/page-data/${normalizedPath}.json${navigationUrl.search}`;

      logger.debug(`Fetching SPA page data from ${endpoint}`);

      const response = await fetch(endpoint, {
        headers: this.navigationHeaders("spa"),
      });

      if (response.status === 409) {
        this.failDependencySnapshot(
          path,
          `Dependency snapshot is unavailable for SPA page data ${path}`,
        );
      }
      if (!response.ok) {
        throw NETWORK_ERROR.create({
          detail: `Failed to fetch SPA page data for ${path}`,
          status: response.status,
          context: { path },
        });
      }

      const data = await response.json() as SpaPageData;
      this.assertDependencySnapshot(
        data.dependencyPinningCacheKey,
        path,
        "SPA page data",
      );
      return data;
    } catch (error) {
      this.recoverSnapshotFailure(error, path, reloadOnSnapshotFailure);
      throw error;
    }
  }

  loadSpaPageData(path: string): Promise<SpaPageData> {
    return this.loadSpaPageDataWithSnapshotRecovery(path, true);
  }

  private loadSpaPageDataWithSnapshotRecovery(
    path: string,
    reloadOnSnapshotFailure: boolean,
  ): Promise<SpaPageData> {
    const cachedData = this.getSpaCached(path);
    if (cachedData) {
      logger.debug(`Loading SPA data for ${path} from cache`);
      return Promise.resolve(cachedData);
    }

    const pendingKey = this.snapshotScopedPath(path);
    const pending = this.pendingSpaRequests.get(pendingKey);
    if (pending) {
      logger.debug(`Reusing pending SPA request for ${path}`);
      return this.withSnapshotRecovery(
        pending,
        path,
        reloadOnSnapshotFailure,
      );
    }

    logger.debug(`Creating pending SPA request for ${path}`);

    const request = this.createPendingRequest(pendingKey, this.pendingSpaRequests, async () => {
      const data = await this.fetchSpaPageData(path, false);
      this.setSpaCache(path, data);
      return data;
    });
    return this.withSnapshotRecovery(
      request,
      path,
      reloadOnSnapshotFailure,
    );
  }

  async prefetchSpaPageData(path: string): Promise<void> {
    if (this.isSpaDataCached(path)) return;

    logger.debug(`Prefetching SPA page data for ${path}`);

    try {
      await this.loadSpaPageDataWithSnapshotRecovery(path, false);
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

  private snapshotScopedPath(path: string): string {
    return this.dependencyPinningCacheKey.startsWith("on:")
      ? `${this.dependencyPinningCacheKey}\0${path}`
      : path;
  }

  private navigationHeaders(type: "client" | "spa"): Record<string, string> {
    return {
      "X-Veryfront-Navigation": type,
      ...(this.dependencyPinningCacheKey.startsWith("on:")
        ? {
          [DEPENDENCY_PINNING_RESPONSE_HEADER]: this.dependencyPinningCacheKey,
        }
        : {}),
    };
  }

  private assertDependencySnapshot(
    actualCacheKey: unknown,
    path: string,
    source: string,
  ): void {
    const expectedCacheKey = this.dependencyPinningCacheKey.startsWith("on:")
      ? this.dependencyPinningCacheKey
      : undefined;
    const normalizedActualCacheKey = typeof actualCacheKey === "string"
      ? actualCacheKey
      : undefined;
    const matches = expectedCacheKey
      ? normalizedActualCacheKey === expectedCacheKey
      : normalizedActualCacheKey === undefined || normalizedActualCacheKey === "off";
    if (matches) return;

    this.failDependencySnapshot(
      path,
      `Dependency snapshot mismatch in ${source} for ${path}`,
    );
  }

  private failDependencySnapshot(path: string, detail: string): never {
    throw NETWORK_ERROR.create({
      detail,
      status: 409,
      context: { path },
    });
  }

  private withSnapshotRecovery<T>(
    promise: Promise<T>,
    path: string,
    reloadOnSnapshotFailure: boolean,
  ): Promise<T> {
    return promise.catch((error) => {
      this.recoverSnapshotFailure(error, path, reloadOnSnapshotFailure);
      throw error;
    });
  }

  private recoverSnapshotFailure(
    error: unknown,
    path: string,
    reloadOnSnapshotFailure: boolean,
  ): void {
    if (
      !reloadOnSnapshotFailure ||
      typeof error !== "object" ||
      error === null ||
      (error as { status?: unknown }).status !== 409
    ) {
      return;
    }
    if (this.snapshotRecoveryStarted) return;

    // Foreground soft navigation starts a fresh document boundary. Speculative
    // prefetch callers pass false and only log/drop the failed request.
    this.snapshotRecoveryStarted = true;
    try {
      this.reloadDocument(path);
    } catch (reloadError) {
      this.snapshotRecoveryStarted = false;
      logger.warn(
        `[Veryfront] Failed to reload after dependency snapshot conflict for ${path}`,
        reloadError instanceof Error ? reloadError : new Error(String(reloadError)),
      );
    }
  }
}
