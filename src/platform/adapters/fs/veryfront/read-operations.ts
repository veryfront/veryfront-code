import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "#veryfront/utils";
import { isFrameworkSourcePath } from "#veryfront/utils/path-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  recordContentCacheHit,
  recordContentNetworkFetch,
} from "#veryfront/observability/simple-metrics/index.ts";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import { getRequestScopedFile, setRequestScopedFile } from "./multi-project-adapter.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import type { ResolvedContentContext } from "./types.ts";

export interface ContentContextProvider {
  isProductionMode: () => boolean;
  getReleaseId: () => string | null;
  getContentContext: () => ResolvedContentContext | null;
  /** Cached file list from adapter initialization (single source of truth) */
  getFileList?: () => Promise<
    Array<{
      id?: string;
      path: string;
      content?: string;
      type?: string;
      size?: number;
      updated_at?: string;
    }> | undefined
  >;
  /** True if cache prefix is being deleted - skip persistent cache reads */
  isPersistentCacheInvalidated?: (prefix: string) => boolean;
  /** Back-compat: release-scoped invalidation */
  isReleaseBeingInvalidated?: (releaseId: string) => boolean;
}

const EXTENSION_PRIORITY = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"] as const;
const EXTENSION_PRIORITY_ARRAY = [...EXTENSION_PRIORITY];
const HAS_KNOWN_EXTENSION_REGEX = /\.(tsx|ts|jsx|js|mdx|md)$/;

const IN_FLIGHT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_IN_FLIGHT_REQUESTS = 100;

// ============================================================================
// CONTENT METRICS - Per-request tracking for optimization decisions
// ============================================================================

type FileType = "page" | "layout" | "component" | "api" | "data" | "config" | "other";
type MissReason = "cold_start" | "not_in_filelist" | "invalidation" | "no_filelist_cache";

interface PerRequestMetrics {
  startTime: number;
  // Cache layer hits
  requestScopedHits: number;
  persistentCacheHits: number;
  fileListHits: number;
  // Network
  networkFetches: number;
  networkMs: number;
  // File type breakdown (for fetches only - where optimization matters)
  fetchesByType: Record<FileType, number>;
  // Miss reasons
  missReasons: Record<MissReason, number>;
  // Mode tracking
  isPreviewMode: boolean | null;
  // Unique files accessed
  filesAccessed: Set<string>;
}

// Global cumulative metrics (for /metrics endpoint)
interface CumulativeMetrics {
  requestScopedHits: number;
  persistentCacheHits: number;
  fileListHits: number;
  networkFetches: number;
  totalNetworkMs: number;
  requestsTracked: number;
}

const cumulativeMetrics: CumulativeMetrics = {
  requestScopedHits: 0,
  persistentCacheHits: 0,
  fileListHits: 0,
  networkFetches: 0,
  totalNetworkMs: 0,
  requestsTracked: 0,
};

// Per-request metrics (reset each request via startRequestMetrics)
const metricsStore = new AsyncLocalStorage<PerRequestMetrics>();

function createFreshRequestMetrics(): PerRequestMetrics {
  return {
    startTime: performance.now(),
    requestScopedHits: 0,
    persistentCacheHits: 0,
    fileListHits: 0,
    networkFetches: 0,
    networkMs: 0,
    fetchesByType: { page: 0, layout: 0, component: 0, api: 0, data: 0, config: 0, other: 0 },
    missReasons: { cold_start: 0, not_in_filelist: 0, invalidation: 0, no_filelist_cache: 0 },
    isPreviewMode: null,
    filesAccessed: new Set(),
  };
}

const API_ROUTE_REGEX = /^(pages|app)\/api\//;
const LAYOUT_REGEX = /\/layout(\.|\/)/;
const PAGE_REGEX = /^(pages|app)\//;
const COMPONENT_REGEX = /(^|\/)components\//;
const DATA_EXTENSION_REGEX = /\.(json|yaml|yml)$/;
const CONFIG_REGEX = /config|\.config\./;

function detectFileType(path: string): FileType {
  if (API_ROUTE_REGEX.test(path)) return "api";
  if (LAYOUT_REGEX.test(path)) return "layout";
  if (PAGE_REGEX.test(path)) return "page";
  if (COMPONENT_REGEX.test(path)) return "component";
  if (DATA_EXTENSION_REGEX.test(path)) return "data";
  if (CONFIG_REGEX.test(path)) return "config";
  return "other";
}

/** Call at start of HTTP request to begin per-request tracking */
export function startRequestMetrics(): void {
  metricsStore.enterWith(createFreshRequestMetrics());
}

/** Call at end of HTTP request to log summary and update cumulative metrics */
export function endRequestMetrics(
  requestContext?: { requestId?: string; pathname?: string; mode?: string },
): void {
  const req = metricsStore.getStore();
  if (!req) return;
  const durationMs = Math.round(performance.now() - req.startTime);

  // Compute derived metrics
  const totalCacheHits = req.requestScopedHits + req.persistentCacheHits + req.fileListHits;
  const totalOperations = totalCacheHits + req.networkFetches;
  const cacheHitRate = totalOperations > 0
    ? Math.round((totalCacheHits / totalOperations) * 100)
    : 100;
  const networkTimeRatio = durationMs > 0 ? Math.round((req.networkMs / durationMs) * 100) : 0;

  // Update cumulative metrics
  cumulativeMetrics.requestScopedHits += req.requestScopedHits;
  cumulativeMetrics.persistentCacheHits += req.persistentCacheHits;
  cumulativeMetrics.fileListHits += req.fileListHits;
  cumulativeMetrics.networkFetches += req.networkFetches;
  cumulativeMetrics.totalNetworkMs += req.networkMs;
  cumulativeMetrics.requestsTracked++;

  // Record to production metrics system
  recordContentNetworkFetch(req.networkMs, req.isPreviewMode ?? false);

  // Log summary
  logger.info("[ContentMetrics] REQUEST_SUMMARY", {
    ...requestContext,
    // Timing
    durationMs,
    networkMs: req.networkMs,
    networkTimeRatio: `${networkTimeRatio}%`,
    // Cache performance
    cacheHitRate: `${cacheHitRate}%`,
    cacheHits: {
      l1_request: req.requestScopedHits,
      l2_persistent: req.persistentCacheHits,
      l3_filelist: req.fileListHits,
    },
    networkFetches: req.networkFetches,
    // Breakdown
    fetchesByType: req.fetchesByType,
    missReasons: req.missReasons,
    // Context
    uniqueFiles: req.filesAccessed.size,
    isPreviewMode: req.isPreviewMode,
  });
}

type ContentMetricEvent =
  | "REQUEST_SCOPED_HIT"
  | "PERSISTENT_CACHE_HIT"
  | "FILE_LIST_HIT"
  | "IN_FLIGHT_JOIN_HIT"
  | "NETWORK_FETCH"
  | "NETWORK_FETCH_COMPLETE"
  | "CACHE_MISS";

function logContentMetric(
  event: ContentMetricEvent,
  details: {
    path?: string;
    mode?: string;
    isPreviewMode?: boolean;
    durationMs?: number;
    missReason?: MissReason;
    [key: string]: unknown;
  },
): void {
  const path = details.path ?? "";
  const currentRequest = metricsStore.getStore();

  // Track in per-request metrics if active
  if (currentRequest) {
    currentRequest.filesAccessed.add(path);
    if (details.isPreviewMode !== undefined) {
      currentRequest.isPreviewMode = details.isPreviewMode;
    }

    switch (event) {
      case "REQUEST_SCOPED_HIT":
        currentRequest.requestScopedHits++;
        recordContentCacheHit("request");
        break;
      case "PERSISTENT_CACHE_HIT":
        currentRequest.persistentCacheHits++;
        recordContentCacheHit("persistent");
        break;
      case "FILE_LIST_HIT":
        currentRequest.fileListHits++;
        recordContentCacheHit("filelist");
        break;
      case "IN_FLIGHT_JOIN_HIT":
        // Join hits are counted as request-scoped hits for metrics purposes
        // as they avoided any additional L2/L3/API work for this request.
        currentRequest.requestScopedHits++;
        recordContentCacheHit("request");
        break;
      case "NETWORK_FETCH":
        currentRequest.networkFetches++;
        currentRequest.fetchesByType[detectFileType(path)]++;
        break;
      case "NETWORK_FETCH_COMPLETE":
        if (details.durationMs) {
          currentRequest.networkMs += details.durationMs;
        }
        break;
      case "CACHE_MISS":
        if (details.missReason) {
          currentRequest.missReasons[details.missReason]++;
        }
        break;
    }
  }

  // Debug log individual events (not info level to reduce noise)
  logger.debug(`[ContentMetrics] ${event}`, details);
}

/** Get current cumulative metrics snapshot for /metrics endpoint */
export function getContentMetricsSnapshot(): CumulativeMetrics & {
  avgNetworkMsPerRequest: number;
} {
  return {
    ...cumulativeMetrics,
    avgNetworkMsPerRequest: cumulativeMetrics.requestsTracked > 0
      ? Math.round(cumulativeMetrics.totalNetworkMs / cumulativeMetrics.requestsTracked)
      : 0,
  };
}

/** Reset cumulative metrics */
export function resetContentMetrics(): void {
  cumulativeMetrics.requestScopedHits = 0;
  cumulativeMetrics.persistentCacheHits = 0;
  cumulativeMetrics.fileListHits = 0;
  cumulativeMetrics.networkFetches = 0;
  cumulativeMetrics.totalNetworkMs = 0;
  cumulativeMetrics.requestsTracked = 0;
}
// ============================================================================

interface InFlightEntry {
  promise: Promise<string>;
  startedAt: number;
}

function hashPreview(content: string): number {
  return content
    .slice(0, 100)
    .split("")
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
}

function previewText(content: string, max = 80): string {
  return content.length > max ? `${content.slice(0, max)}...` : content;
}

export class ReadOperations {
  private readonly inFlightRequests = new Map<string, InFlightEntry>();
  private lastCleanupTime = 0;

  private fileListIndex: Map<string, string> | null = null;
  private fileListIndexKey: string | null = null;
  private fileListIndexPromise: Promise<Map<string, string> | null> | null = null;

  private fileListReadyPromise: Promise<void> | null = null;

  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
    private readonly contextProvider?: ContentContextProvider,
    private readonly getOriginalApiPath?: (path: string) => string,
    private readonly getFileListCache?: () => Promise<
      Array<{ path: string; content?: string }> | undefined
    >,
  ) {}

  setFileListReadyPromise(promise: Promise<void>): void {
    this.fileListReadyPromise = promise;
  }

  clearFileListIndex(): void {
    if (!this.fileListIndex) return;

    const size = this.fileListIndex.size;
    this.fileListIndex = null;
    this.fileListIndexKey = null;
    logger.debug("[ReadOperations] Cleared file list index", { entriesCleared: size });
  }

  private cleanupStaleInFlightRequests(): void {
    const now = Date.now();
    if (now - this.lastCleanupTime < 1000) return;

    this.lastCleanupTime = now;

    let cleanedCount = 0;

    for (const [key, entry] of this.inFlightRequests) {
      if (now - entry.startedAt > IN_FLIGHT_REQUEST_TIMEOUT_MS) {
        this.inFlightRequests.delete(key);
        cleanedCount++;
      }
    }

    if (this.inFlightRequests.size > MAX_IN_FLIGHT_REQUESTS) {
      const entries = [...this.inFlightRequests.entries()].sort(
        (a, b) => a[1].startedAt - b[1].startedAt,
      );
      const toRemove = entries.slice(0, this.inFlightRequests.size - MAX_IN_FLIGHT_REQUESTS);
      for (const [key] of toRemove) {
        this.inFlightRequests.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.warn("[ReadOperations] Cleaned up in-flight requests", {
        cleanedCount,
        remainingCount: this.inFlightRequests.size,
      });
    }
  }

  private async getOrBuildFileListIndex(): Promise<Map<string, string> | null> {
    if (this.fileListIndexPromise) return this.fileListIndexPromise;

    this.fileListIndexPromise = (async () => {
      try {
        if (!this.getFileListCache) {
          logger.debug("[ReadOperations] getOrBuildFileListIndex: no getFileListCache function");
          return null;
        }

        const fileList = await this.getFileListCache();
        if (!fileList) {
          logger.debug(
            "[ReadOperations] getOrBuildFileListIndex: getFileListCache returned null/undefined",
          );
          return null;
        }

        const cacheCheckSample = fileList.find((f) => /welcome/i.test(f.path));
        logger.debug("[ReadOperations] getOrBuildFileListIndex: got file list from cache", {
          fileListSize: fileList.length,
          filesWithContent: fileList.filter((f) => f.content).length,
          sampleFilePath: cacheCheckSample?.path,
          sampleContentLength: cacheCheckSample?.content?.length,
          sampleContentPreview: cacheCheckSample?.content?.slice(0, 200)?.replace(/\n/g, "\\n"),
        });

        const indexKey = `${fileList.length}:${fileList[0]?.path ?? ""}:${
          fileList[fileList.length - 1]?.path ?? ""
        }`;
        if (this.fileListIndex && this.fileListIndexKey === indexKey) return this.fileListIndex;

        const index = new Map<string, string>();
        for (const file of fileList) {
          if (file.content) index.set(file.path, file.content);
        }

        this.fileListIndex = index;
        this.fileListIndexKey = indexKey;

        const sampleFile = fileList.find((f) => /welcome/i.test(f.path));
        const sampleContent = sampleFile?.content;
        logger.debug("[ReadOperations] Built file list index", {
          fileListSize: fileList.length,
          indexedWithContent: index.size,
          sampleFilePath: sampleFile?.path,
          sampleContentLength: sampleContent?.length,
          sampleContentHash: sampleContent ? hashPreview(sampleContent) : undefined,
          sampleContentPreview: sampleContent?.slice(0, 200)?.replace(/\n/g, "\\n"),
        });

        return index;
      } finally {
        this.fileListIndexPromise = null;
      }
    })();

    return this.fileListIndexPromise;
  }

  private async getContentFromFileList(normalizedPath: string): Promise<string | undefined> {
    if (this.fileListReadyPromise) {
      try {
        await this.fileListReadyPromise;
      } catch {
        logger.debug("[ReadOperations] File list initialization failed, will fetch individually");
      }
    }

    const index = await this.getOrBuildFileListIndex();
    if (!index) {
      logger.debug("[ReadOperations] No file list cache available");
      return undefined;
    }

    const content = index.get(normalizedPath);
    if (!content) {
      logger.debug("[ReadOperations] Content not in file list index", {
        path: normalizedPath,
        indexSize: index.size,
      });
      return undefined;
    }

    logger.debug("[ReadOperations] FILE_LIST_CACHE_HIT - serving from file list cache", {
      path: normalizedPath,
      contentLength: content.length,
      contentHash: hashPreview(content),
      contentPreview: previewText(content, 200).replace(/\n/g, "\\n"),
    });

    return content;
  }

  readFile(path: string): Promise<Uint8Array> {
    return withSpan(
      "fs.veryfront.readFile",
      async () => {
        const normalizedPath = this.normalizer.normalize(path);
        const content = await this.fetchContent(normalizedPath);
        return new TextEncoder().encode(content);
      },
      { "fs.path": path },
    );
  }

  readTextFile(path: string): Promise<string> {
    return withSpan(
      "fs.veryfront.readTextFile",
      () => {
        const normalizedPath = this.normalizer.normalize(path);
        logger.debug("[ReadOperations] readTextFile called", { path, normalizedPath });
        return this.fetchContent(normalizedPath);
      },
      { "fs.path": path },
    );
  }

  private async fetchContent(normalizedPath: string): Promise<string> {
    // Framework paths should NEVER be fetched from API - they must be read from local filesystem.
    if (isFrameworkSourcePath(normalizedPath)) {
      throw new Error(
        `[ReadOperations] Framework path "${normalizedPath}" cannot be fetched from API. ` +
          `Framework modules must be served from local filesystem.`,
      );
    }

    const ctx = this.contextProvider?.getContentContext();
    const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
    const cacheKey = `${cacheKeyPrefix}:${normalizedPath}`;

    // 1. L1 Request Cache (Synchronous check)
    const requestCached = getRequestScopedFile(cacheKey);
    if (requestCached) {
      logContentMetric("REQUEST_SCOPED_HIT", {
        path: normalizedPath,
        mode: ctx?.sourceType ?? "unknown",
        cacheKey,
      });
      return requestCached;
    }

    this.cleanupStaleInFlightRequests();

    // 2. Early In-Flight JOIN: Check if this file is already being fetched by another concurrent request.
    // This deduplicates not only the API fetch, but also the L2/L3 cache lookups and extension resolution.
    const existingEntry = this.inFlightRequests.get(cacheKey);
    if (existingEntry) {
      logContentMetric("IN_FLIGHT_JOIN_HIT", {
        path: normalizedPath,
        mode: ctx?.sourceType ?? "unknown",
        cacheKey,
      });
      logger.debug("[ReadOperations] Joining in-flight request", {
        path: normalizedPath,
        cacheKey,
        ageMs: Date.now() - existingEntry.startedAt,
      });
      const content = await existingEntry.promise;
      // Populate L1 cache for the joining request to ensure consistency within this request's render
      setRequestScopedFile(cacheKey, content);
      return content;
    }

    // 3. Start fetch pipeline and track it for other concurrent requests to join
    const fetchPromise = this.performContentFetch(normalizedPath, cacheKey, cacheKeyPrefix, ctx);
    this.inFlightRequests.set(cacheKey, { promise: fetchPromise, startedAt: Date.now() });

    try {
      return await fetchPromise;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Internal fetch pipeline that checks L2, L3, resolves extensions, and performs API fetches.
   * Extracted from fetchContent to reduce nesting and improve readability.
   */
  private async performContentFetch(
    normalizedPath: string,
    cacheKey: string,
    cacheKeyPrefix: string,
    ctx: ResolvedContentContext | null | undefined,
  ): Promise<string> {
    const isProduction = this.contextProvider?.isProductionMode() ?? false;
    const apiPath = this.getOriginalApiPath?.(normalizedPath) ?? normalizedPath;
    const hasKnownExt = HAS_KNOWN_EXTENSION_REGEX.test(apiPath);
    const isPreviewMode = ctx?.sourceType === "branch";

    const currentReleaseId = ctx?.releaseId;
    const isPrefixInvalidated =
      (isProduction && this.contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix)) ??
        false;
    const isReleaseInvalidated = isProduction && currentReleaseId
      ? this.contextProvider?.isReleaseBeingInvalidated?.(currentReleaseId)
      : undefined;

    const skipPersistentCaches = !!(isPrefixInvalidated || isReleaseInvalidated);

    if (isProduction && skipPersistentCaches) {
      logger.info("[ReadOperations] PERSISTENT_CACHE_SKIPPED - cache invalidation in progress", {
        path: normalizedPath,
        cacheKey,
        cacheKeyPrefix,
        releaseId: currentReleaseId ?? undefined,
        prefixInvalidated: isPrefixInvalidated,
      });
    }

    // Check persistent cache for PRODUCTION mode only
    if (isProduction && !skipPersistentCaches) {
      const cached = await this.cache.getAsync<string>(cacheKey);
      if (cached) {
        logContentMetric("PERSISTENT_CACHE_HIT", {
          path: normalizedPath,
          mode: ctx?.sourceType ?? "unknown",
          cacheKey,
        });
        setRequestScopedFile(cacheKey, cached);
        return cached;
      }
    }

    // File list cache (available for both modes)
    if (!skipPersistentCaches) {
      const fileListContent = await this.getContentFromFileList(normalizedPath);
      if (fileListContent) {
        logContentMetric("FILE_LIST_HIT", {
          path: normalizedPath,
          mode: ctx?.sourceType ?? "unknown",
          cacheKey,
          isPreviewMode,
        });
        if (isProduction) this.cache.set(cacheKey, fileListContent);
        setRequestScopedFile(cacheKey, fileListContent);
        return fileListContent;
      }
    } else {
      logContentMetric("CACHE_MISS", {
        path: normalizedPath,
        mode: ctx?.sourceType ?? "unknown",
        missReason: "invalidation" as MissReason,
        isPreviewMode,
      });
    }

    // API Extension Resolution
    if (!hasKnownExt) {
      try {
        const resolved = await this.client.resolveFileWithExtension(
          apiPath,
          EXTENSION_PRIORITY_ARRAY,
        );
        if (resolved) {
          const resolvedPath = this.normalizer.normalize(resolved.path);
          const resolvedCacheKey = `${cacheKeyPrefix}:${resolvedPath}`;

          if (isProduction) {
            this.cache.set(cacheKey, resolved.content);
            if (resolvedCacheKey !== cacheKey) this.cache.set(resolvedCacheKey, resolved.content);
          }

          setRequestScopedFile(cacheKey, resolved.content);
          if (resolvedCacheKey !== cacheKey) {
            setRequestScopedFile(resolvedCacheKey, resolved.content);
          }

          return resolved.content;
        }
      } catch (error) {
        logger.debug("[ReadOperations] resolveFileWithExtension failed", {
          basePath: apiPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const isPublished = ctx?.sourceType !== "branch";
    const hasFileListCache = !!this.getFileListCache;

    logContentMetric("CACHE_MISS", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      missReason: (hasFileListCache ? "not_in_filelist" : "no_filelist_cache") as MissReason,
      isPreviewMode,
    });

    // NETWORK FETCH
    logContentMetric("NETWORK_FETCH", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      isPublished,
      isPreviewMode,
    });

    const fetchStartTime = performance.now();
    const result = isPublished
      ? await this.fetchPublishedContent(
        normalizedPath,
        apiPath,
        cacheKey,
        ctx?.releaseId ?? null,
        ctx?.environmentName ?? null,
        isProduction,
      )
      : await this.fetchDraftContent(normalizedPath, apiPath, cacheKey, isProduction);

    const fetchDuration = Math.round(performance.now() - fetchStartTime);

    logContentMetric("NETWORK_FETCH_COMPLETE", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      durationMs: fetchDuration,
      contentLength: result.length,
      isPreviewMode,
    });

    return result;
  }

  private async fetchPublishedContent(
    normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    releaseId: string | null,
    environmentName: string | null,
    shouldCache: boolean,
  ): Promise<string> {
    logger.debug("[ReadOperations] Fetching published content", {
      path: normalizedPath,
      apiPath,
      cacheKey,
      environmentName: environmentName ?? undefined,
    });

    try {
      const content = await this.client.getPublishedFileContent(
        apiPath,
        releaseId ?? undefined,
        environmentName ?? undefined,
      );

      logger.debug("[ReadOperations] Fetched published content", {
        path: normalizedPath,
        contentLength: content.length,
        releaseId,
      });

      if (shouldCache) this.cache.set(cacheKey, content);
      setRequestScopedFile(cacheKey, content);
      return content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const is404Error = errorMessage.includes("404") || errorMessage.includes("Not Found");

      if (!is404Error) {
        logger.error("[ReadOperations] Failed to fetch published content", {
          path: normalizedPath,
          apiPath,
          releaseId,
          error: errorMessage,
        });
        throw error;
      }

      const fallbackContent = await this.tryFallbackExtensions(
        apiPath,
        cacheKey,
        shouldCache,
        releaseId,
        environmentName,
      );
      if (fallbackContent !== null) return fallbackContent;

      logger.debug("[ReadOperations] File not found (expected for optional files)", {
        path: normalizedPath,
        apiPath,
      });
      throw error;
    }
  }

  private async tryFallbackExtensions(
    apiPath: string,
    cacheKey: string,
    shouldCache: boolean,
    releaseId: string | null,
    environmentName?: string | null,
  ): Promise<string | null> {
    const extMatch = apiPath.match(/\.(tsx|ts|jsx|js|mdx|md)$/);
    if (!extMatch) return null;

    const originalExt = extMatch[0];
    const basePath = apiPath.slice(0, -originalExt.length);

    logger.debug("[ReadOperations] Searching for file with pattern", {
      originalPath: apiPath,
      pattern: `${basePath}.*`,
    });

    try {
      const result = await this.client.resolveFileWithExtension(basePath, EXTENSION_PRIORITY_ARRAY);
      if (!result) return null;

      logger.debug("[ReadOperations] Pattern search found file", {
        originalPath: apiPath,
        foundPath: result.path,
        contentLength: result.content.length,
      });

      if (shouldCache) this.cache.set(cacheKey, result.content);
      setRequestScopedFile(cacheKey, result.content);
      return result.content;
    } catch (error) {
      logger.debug("[ReadOperations] Pattern search failed, trying sequential fallback", {
        originalPath: apiPath,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.tryFallbackExtensionsSequential(
        apiPath,
        originalExt,
        basePath,
        cacheKey,
        shouldCache,
        releaseId,
        environmentName,
      );
    }
  }

  private async tryFallbackExtensionsSequential(
    apiPath: string,
    originalExt: string,
    basePath: string,
    cacheKey: string,
    shouldCache: boolean,
    releaseId: string | null,
    environmentName?: string | null,
  ): Promise<string | null> {
    for (const ext of EXTENSION_PRIORITY) {
      if (ext === originalExt) continue;

      const fallbackPath = basePath + ext;

      try {
        const content = await this.client.getPublishedFileContent(
          fallbackPath,
          releaseId ?? undefined,
          environmentName ?? undefined,
        );

        logger.debug("[ReadOperations] Sequential fallback succeeded", {
          originalPath: apiPath,
          fallbackPath,
          contentLength: content.length,
        });

        if (shouldCache) this.cache.set(cacheKey, content);
        setRequestScopedFile(cacheKey, content);
        return content;
      } catch {
        // continue
      }
    }

    return null;
  }

  private async fetchDraftContent(
    normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    shouldCache: boolean,
  ): Promise<string> {
    logger.info("[ReadOperations] API_FETCH_START - fetching draft from API", {
      path: normalizedPath,
      apiPath,
      cacheKey,
    });

    const content = await this.client.getFileContent(apiPath);

    logger.info("[ReadOperations] API_FETCH_DONE - got content from API", {
      path: normalizedPath,
      contentLength: content.length,
      preview: previewText(content).replace(/\n/g, "\\n"),
      willCache: shouldCache,
    });

    if (shouldCache) this.cache.set(cacheKey, content);
    setRequestScopedFile(cacheKey, content);
    return content;
  }
}
