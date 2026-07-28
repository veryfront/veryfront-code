import { rendererLogger } from "#veryfront/utils";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { parsePageDataFromHTMLStrict } from "./dom-utils.ts";

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

export class PageLoader {
  private cache = new Map<string, RouteData>();
  private spaCache = new Map<string, SpaPageData>();
  private pendingRequests = new Map<string, Promise<RouteData>>();
  private pendingSpaRequests = new Map<string, Promise<SpaPageData>>();
  private activeRequests = new Set<AbortController>();
  private cacheGeneration = 0;

  private evictIfFull<T>(map: Map<string, T>, key: string): void {
    if (map.has(key)) return;
    if (map.size < MAX_CACHE_SIZE) return;

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
    return this.spaCache.get(path);
  }

  isSpaDataCached(path: string): boolean {
    return this.spaCache.has(path);
  }

  setSpaCache(path: string, data: SpaPageData): void {
    this.evictIfFull(this.spaCache, path);
    this.spaCache.set(path, data);
  }

  async fetchPageData(path: string, signal?: AbortSignal): Promise<RouteData> {
    assertNavigationPath(path);
    return (await this.tryFetchJSON(path, signal)) ?? this.fetchAndParseHTML(path, signal);
  }

  private async tryFetchJSON(path: string, signal?: AbortSignal): Promise<RouteData | null> {
    const navigationUrl = new URL(path, "http://veryfront.local");
    const dataPath = navigationUrl.pathname === "/" ? "/index" : navigationUrl.pathname;
    const response = await fetch(`/_veryfront/data${dataPath}.json${navigationUrl.search}`, {
      headers: { "X-Veryfront-Navigation": "client" },
      signal,
    });

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
    return data as RouteData;
  }

  private async fetchAndParseHTML(path: string, signal?: AbortSignal): Promise<RouteData> {
    const response = await fetch(path, {
      headers: { "X-Veryfront-Navigation": "client" },
      signal,
    });

    if (!response.ok) {
      cancelResponseBody(response);
      throw NETWORK_ERROR.create({
        detail: `Failed to fetch ${path}`,
        status: response.status,
        context: { path },
      });
    }

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

    return { html: content, ...pageData };
  }

  loadPage(path: string): Promise<RouteData> {
    assertNavigationPath(path);
    const cachedData = this.getCached(path);
    if (cachedData) {
      logger.debug(`Loading ${path} from cache`);
      return Promise.resolve(cachedData);
    }

    const pending = this.pendingRequests.get(path);
    if (pending) {
      logger.debug(`Reusing pending request for ${path}`);
      return pending;
    }

    logger.debug(`Creating pending request for ${path}`);

    return this.createPendingRequest(path, this.pendingRequests, async (signal) => {
      const generation = this.cacheGeneration;
      const data = await this.fetchPageData(path, signal);
      if (generation === this.cacheGeneration) this.setCache(path, data);
      return data;
    });
  }

  async prefetch(path: string): Promise<void> {
    if (this.isCached(path)) return;

    logger.debug(`Prefetching ${path}`);

    try {
      await this.loadPage(path);
    } catch (error) {
      logger.warn(
        `[Veryfront] Failed to prefetch ${path}`,
        error instanceof Error ? error : new Error(snapshotThrowableDiagnostic(error)),
      );
    }
  }

  async fetchSpaPageData(path: string, signal?: AbortSignal): Promise<SpaPageData> {
    assertNavigationPath(path);
    const navigationUrl = new URL(path, "http://veryfront.local");
    const normalizedPath = navigationUrl.pathname === "/"
      ? "index"
      : navigationUrl.pathname.replace(/^\//, "");
    const endpoint = `/_veryfront/page-data/${normalizedPath}.json${navigationUrl.search}`;

    logger.debug(`Fetching SPA page data from ${endpoint}`);

    const response = await fetch(endpoint, {
      headers: { "X-Veryfront-Navigation": "spa" },
      signal,
    });

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
    return data as SpaPageData;
  }

  loadSpaPageData(path: string): Promise<SpaPageData> {
    assertNavigationPath(path);
    const cachedData = this.getSpaCached(path);
    if (cachedData) {
      logger.debug(`Loading SPA data for ${path} from cache`);
      return Promise.resolve(cachedData);
    }

    const pending = this.pendingSpaRequests.get(path);
    if (pending) {
      logger.debug(`Reusing pending SPA request for ${path}`);
      return pending;
    }

    logger.debug(`Creating pending SPA request for ${path}`);

    return this.createPendingRequest(path, this.pendingSpaRequests, async (signal) => {
      const generation = this.cacheGeneration;
      const data = await this.fetchSpaPageData(path, signal);
      if (generation === this.cacheGeneration) this.setSpaCache(path, data);
      return data;
    });
  }

  async prefetchSpaPageData(path: string): Promise<void> {
    if (this.isSpaDataCached(path)) return;

    logger.debug(`Prefetching SPA page data for ${path}`);

    try {
      await this.loadSpaPageData(path);
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
