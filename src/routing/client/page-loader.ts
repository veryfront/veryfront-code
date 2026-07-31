import { rendererLogger } from "#veryfront/utils";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { parsePageDataFromHTML, parsePageDataFromHTMLStrict } from "./dom-utils.ts";

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
const MAX_NAVIGATION_PATH_LENGTH = 8_192;
const MAX_PAGE_RESPONSE_BYTES = 4 * 1024 * 1024;
const EXPLICIT_URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const UTF8_ENCODER = new TextEncoder();
const HYDRATION_DATA_ID = "veryfront-hydration-data";
const DEPENDENCY_PINNING_RESPONSE_HEADER = "x-veryfront-dependency-pins";

type HydrationDocument = Pick<Document, "getElementById">;
type DocumentReloader = (url: string) => void;

function reloadBrowserDocument(url: string): void {
  if (typeof globalThis.location !== "undefined") {
    globalThis.location.assign(url);
  }
}

function readDependencyPinningCacheKey(doc?: HydrationDocument): string {
  if (!doc) return "off";

  try {
    const hydrationDataElement = doc.getElementById(HYDRATION_DATA_ID);
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
  private readonly snapshotRecoveryPromises = new WeakMap<
    Promise<unknown>,
    Promise<unknown>
  >();
  private activeRequests = new Set<AbortController>();
  private cacheGeneration = 0;
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

  private evictIfFull<T>(map: Map<string, T>, key: string): void {
    if (map.has(key)) return;
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
    const key = this.snapshotScopedPath(path);
    this.evictIfFull(this.cache, key);
    this.cache.set(key, data);
  }

  clearCache(): void {
    this.cacheGeneration++;
    for (const controller of this.activeRequests) {
      controller.abort(new DOMException("Page loader cache was cleared", "AbortError"));
    }
    this.activeRequests.clear();
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
    const key = this.snapshotScopedPath(path);
    this.evictIfFull(this.spaCache, key);
    this.spaCache.set(key, data);
  }

  async fetchPageData(
    path: string,
    signalOrReloadOnSnapshotFailure?: AbortSignal | boolean,
    reloadOnSnapshotFailure = true,
  ): Promise<RouteData> {
    assertNavigationPath(path);
    const signal = typeof signalOrReloadOnSnapshotFailure === "boolean"
      ? undefined
      : signalOrReloadOnSnapshotFailure;
    const shouldReload = typeof signalOrReloadOnSnapshotFailure === "boolean"
      ? signalOrReloadOnSnapshotFailure
      : reloadOnSnapshotFailure;
    try {
      return (await this.tryFetchJSON(path, signal)) ??
        await this.fetchAndParseHTML(path, signal);
    } catch (error) {
      this.recoverSnapshotFailure(error, path, shouldReload);
      throw error;
    }
  }

  private async tryFetchJSON(
    path: string,
    signal?: AbortSignal,
  ): Promise<RouteData | null> {
    const navigationUrl = new URL(path, "http://veryfront.local");
    const dataPath = navigationUrl.pathname === "/" ? "/index" : navigationUrl.pathname;
    const endpoint = `/_veryfront/data${dataPath}.json${navigationUrl.search}`;
    const response = await fetch(endpoint, {
      headers: this.navigationHeaders("client"),
      signal,
    });

    if (response.status === 409) {
      cancelResponseBody(response);
      this.failDependencySnapshot(
        path,
        `Dependency snapshot is unavailable for ${path}`,
      );
    }
    if (response.status === 404) {
      cancelResponseBody(response);
      return null;
    }
    if (!response.ok) {
      cancelResponseBody(response);
      throw navigationResponseError(path, response.status);
    }

    const text = await readBoundedResponseText(response, path, signal);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (cause) {
      throw NETWORK_ERROR.create({
        detail: `Page data for ${path} contains malformed JSON`,
        cause: snapshotThrowableDiagnostic(cause),
      });
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw NETWORK_ERROR.create({
        detail: `Page data for ${path} must be a JSON object`,
      });
    }
    this.assertDependencySnapshot(
      (data as RouteData).dependencyPinningCacheKey,
      path,
      "route data",
    );
    return data as RouteData;
  }

  private async fetchAndParseHTML(path: string, signal?: AbortSignal): Promise<RouteData> {
    const response = await fetch(path, {
      headers: this.navigationHeaders("client"),
      signal,
    });

    if (response.status === 409) {
      cancelResponseBody(response);
      this.failDependencySnapshot(
        path,
        `Dependency snapshot is unavailable for ${path}`,
      );
    }
    if (!response.ok) {
      cancelResponseBody(response);
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

    const html = await readBoundedResponseText(response, path, signal);
    let parsed: ReturnType<typeof parsePageDataFromHTMLStrict>;
    try {
      parsed = parsePageDataFromHTMLStrict(html);
    } catch (cause) {
      throw NETWORK_ERROR.create({
        detail: `Navigation HTML for ${path} is malformed`,
        cause: snapshotThrowableDiagnostic(cause),
      });
    }
    const { content, pageData } = parsed;
    const { dependencyPinningCacheKey } = parsePageDataFromHTML(html);
    this.assertDependencySnapshot(
      dependencyPinningCacheKey,
      path,
      "HTML body",
    );

    return { html: content, ...pageData };
  }

  loadPage(path: string): Promise<RouteData> {
    return this.loadPageWithSnapshotRecovery(path, true);
  }

  private loadPageWithSnapshotRecovery(
    path: string,
    reloadOnSnapshotFailure: boolean,
  ): Promise<RouteData> {
    assertNavigationPath(path);
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

    const request = this.createPendingRequest(
      pendingKey,
      this.pendingRequests,
      async (signal) => {
        const generation = this.cacheGeneration;
        const data = await this.fetchPageData(path, signal, false);
        if (generation === this.cacheGeneration) this.setCache(path, data);
        return data;
      },
    );
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
        error instanceof Error ? error : new Error(snapshotThrowableDiagnostic(error)),
      );
    }
  }

  async fetchSpaPageData(
    path: string,
    signalOrReloadOnSnapshotFailure?: AbortSignal | boolean,
    reloadOnSnapshotFailure = true,
  ): Promise<SpaPageData> {
    assertNavigationPath(path);
    const signal = typeof signalOrReloadOnSnapshotFailure === "boolean"
      ? undefined
      : signalOrReloadOnSnapshotFailure;
    const shouldReload = typeof signalOrReloadOnSnapshotFailure === "boolean"
      ? signalOrReloadOnSnapshotFailure
      : reloadOnSnapshotFailure;
    try {
      const navigationUrl = new URL(path, "http://veryfront.local");
      const normalizedPath = navigationUrl.pathname === "/"
        ? "index"
        : navigationUrl.pathname.replace(/^\//, "");
      const endpoint = `/_veryfront/page-data/${normalizedPath}.json${navigationUrl.search}`;

      logger.debug(`Fetching SPA page data from ${endpoint}`);

      const response = await fetch(endpoint, {
        headers: this.navigationHeaders("spa"),
        signal,
      });

      if (response.status === 409) {
        cancelResponseBody(response);
        this.failDependencySnapshot(
          path,
          `Dependency snapshot is unavailable for SPA page data ${path}`,
        );
      }
      if (!response.ok) {
        cancelResponseBody(response);
        throw NETWORK_ERROR.create({
          detail: `Failed to fetch SPA page data for ${path}`,
          status: response.status,
          context: { path },
        });
      }

      const text = await readBoundedResponseText(response, path, signal);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (cause) {
        throw NETWORK_ERROR.create({
          detail: `SPA page data for ${path} contains malformed JSON`,
          cause: snapshotThrowableDiagnostic(cause),
        });
      }
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw NETWORK_ERROR.create({
          detail: `SPA page data for ${path} must be a JSON object`,
        });
      }
      this.assertDependencySnapshot(
        (data as SpaPageData).dependencyPinningCacheKey,
        path,
        "SPA page data",
      );
      return data as SpaPageData;
    } catch (error) {
      this.recoverSnapshotFailure(error, path, shouldReload);
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
    assertNavigationPath(path);
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

    const request = this.createPendingRequest(
      pendingKey,
      this.pendingSpaRequests,
      async (signal) => {
        const generation = this.cacheGeneration;
        const data = await this.fetchSpaPageData(path, signal, false);
        if (generation === this.cacheGeneration) this.setSpaCache(path, data);
        return data;
      },
    );
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
        error instanceof Error ? error : new Error(snapshotThrowableDiagnostic(error)),
      );
    }
  }

  private createPendingRequest<T>(
    path: string,
    pendingMap: Map<string, Promise<T>>,
    fetcher: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    this.activeRequests.add(controller);
    const owner: { request?: Promise<T> } = {};
    const request = (async () => {
      try {
        return await fetcher(controller.signal);
      } finally {
        if (pendingMap.get(path) === owner.request) pendingMap.delete(path);
        this.activeRequests.delete(controller);
      }
    })();
    owner.request = request;

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
    if (!reloadOnSnapshotFailure) return promise;

    const existing = this.snapshotRecoveryPromises.get(promise);
    if (existing) return existing as Promise<T>;

    const recovered = promise.catch((error) => {
      this.recoverSnapshotFailure(error, path, reloadOnSnapshotFailure);
      throw error;
    });
    this.snapshotRecoveryPromises.set(promise, recovered);
    return recovered;
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

function assertNavigationPath(path: unknown): asserts path is string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_NAVIGATION_PATH_LENGTH ||
    path.trim() !== path ||
    path.startsWith("#") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    EXPLICIT_URL_SCHEME.test(path) ||
    hasControlCharacters(path)
  ) {
    throw new TypeError(
      `Navigation path must be a non-empty internal URL no longer than ${MAX_NAVIGATION_PATH_LENGTH} characters`,
    );
  }
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function cancelResponseBody(response: Response): void {
  if (!response.body) return;
  try {
    const cancellation = response.body.cancel();
    void cancellation.catch(() => {});
  } catch {
    // Best effort after rejecting response metadata.
  }
}

function navigationResponseError(path: string, status: number): Error {
  return NETWORK_ERROR.create({
    detail: `Failed to fetch ${path}`,
    status,
    context: { path },
  });
}

async function readBoundedResponseText(
  response: Response,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      cancelResponseBody(response);
      throw NETWORK_ERROR.create({
        detail: `Navigation response for ${path} has an invalid Content-Length header`,
      });
    }
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength > MAX_PAGE_RESPONSE_BYTES
    ) {
      cancelResponseBody(response);
      throw NETWORK_ERROR.create({
        detail: `Navigation response for ${path} exceeds the ${MAX_PAGE_RESPONSE_BYTES}-byte limit`,
      });
    }
  }

  let result: Awaited<ReturnType<typeof readResponseTextPrefix>>;
  try {
    result = await readResponseTextPrefix(
      response,
      MAX_PAGE_RESPONSE_BYTES + 1,
      signal,
      { fatalUtf8: true },
    );
  } catch (cause) {
    if (signal?.aborted) signal.throwIfAborted();
    throw NETWORK_ERROR.create({
      detail: `Failed to read navigation response for ${path}`,
      cause: snapshotThrowableDiagnostic(cause),
    });
  }

  if (
    result.truncated ||
    UTF8_ENCODER.encode(result.text).byteLength > MAX_PAGE_RESPONSE_BYTES
  ) {
    throw NETWORK_ERROR.create({
      detail: `Navigation response for ${path} exceeds the ${MAX_PAGE_RESPONSE_BYTES}-byte limit`,
    });
  }
  return result.text;
}
