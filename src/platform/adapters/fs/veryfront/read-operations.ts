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

const IN_FLIGHT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_IN_FLIGHT_REQUESTS = 100;

// ============================================================================
// CONTENT METRICS - Proving cache behavior before optimization
// Remove after analysis is complete
// ============================================================================
interface ContentMetrics {
  requestScopedHits: number;
  persistentCacheHits: number;
  fileListHits: number;
  networkFetches: number;
  previewModeSkips: number;
  productionModeSkips: number;
}

const contentMetrics: ContentMetrics = {
  requestScopedHits: 0,
  persistentCacheHits: 0,
  fileListHits: 0,
  networkFetches: 0,
  previewModeSkips: 0,
  productionModeSkips: 0,
};

function logContentMetric(
  event:
    | "REQUEST_SCOPED_HIT"
    | "PERSISTENT_CACHE_HIT"
    | "FILE_LIST_HIT"
    | "NETWORK_FETCH"
    | "PREVIEW_SKIP_CACHE"
    | "PRODUCTION_SKIP_FILELIST",
  details: Record<string, unknown>,
): void {
  switch (event) {
    case "REQUEST_SCOPED_HIT":
      contentMetrics.requestScopedHits++;
      recordContentCacheHit("request");
      break;
    case "PERSISTENT_CACHE_HIT":
      contentMetrics.persistentCacheHits++;
      recordContentCacheHit("persistent");
      break;
    case "FILE_LIST_HIT":
      contentMetrics.fileListHits++;
      recordContentCacheHit("filelist");
      break;
    case "NETWORK_FETCH":
      contentMetrics.networkFetches++;
      // Note: recordContentNetworkFetch called separately with timing data
      break;
    case "PREVIEW_SKIP_CACHE":
      contentMetrics.previewModeSkips++;
      break;
    case "PRODUCTION_SKIP_FILELIST":
      contentMetrics.productionModeSkips++;
      break;
  }

  // Log every event for analysis
  logger.info(`[ContentMetrics] ${event}`, {
    ...details,
    totals: { ...contentMetrics },
  });
}

/** Get current metrics snapshot for debugging endpoint */
export function getContentMetricsSnapshot(): ContentMetrics {
  return { ...contentMetrics };
}

/** Reset metrics (useful for per-request analysis) */
export function resetContentMetrics(): void {
  contentMetrics.requestScopedHits = 0;
  contentMetrics.persistentCacheHits = 0;
  contentMetrics.fileListHits = 0;
  contentMetrics.networkFetches = 0;
  contentMetrics.previewModeSkips = 0;
  contentMetrics.productionModeSkips = 0;
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
    // If we reach here for a framework path, the module server's local resolution failed.
    if (isFrameworkSourcePath(normalizedPath)) {
      throw new Error(
        `[ReadOperations] Framework path "${normalizedPath}" cannot be fetched from API. ` +
          `Framework modules must be served from local filesystem.`,
      );
    }

    const ctx = this.contextProvider?.getContentContext();
    const apiPath = this.getOriginalApiPath?.(normalizedPath) ?? normalizedPath;
    const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
    const cacheKey = `${cacheKeyPrefix}:${normalizedPath}`;
    const isProduction = this.contextProvider?.isProductionMode() ?? false;
    const hasKnownExt = EXTENSION_PRIORITY.some((ext) => apiPath.endsWith(ext));

    logger.debug("[ReadOperations] fetchContent context", {
      path: normalizedPath,
      hasContextProvider: !!this.contextProvider,
      hasContext: !!ctx,
      sourceType: ctx?.sourceType,
      projectSlug: ctx?.projectSlug,
      branch: ctx?.branch,
      releaseId: ctx?.releaseId,
      cacheKeyPrefix,
      isProduction,
    });

    const requestCached = getRequestScopedFile(cacheKey);
    if (requestCached) {
      logContentMetric("REQUEST_SCOPED_HIT", {
        path: normalizedPath,
        mode: ctx?.sourceType ?? "unknown",
        cacheKey,
      });
      logger.debug("[ReadOperations] REQUEST_CACHE_HIT", {
        path: normalizedPath,
        cacheKey,
        contentLength: requestCached.length,
        preview: previewText(requestCached).replace(/\n/g, "\\n"),
      });
      return requestCached;
    }

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
    // Preview mode skips persistent cache to avoid staleness risk when WebSocket is slow/disconnected
    if (isProduction && !skipPersistentCaches) {
      const cached = await this.cache.getAsync<string>(cacheKey);
      if (cached) {
        logContentMetric("PERSISTENT_CACHE_HIT", {
          path: normalizedPath,
          mode: ctx?.sourceType ?? "unknown",
          cacheKey,
        });
        logger.debug("[ReadOperations] PERSISTENT_CACHE_HIT", {
          path: normalizedPath,
          cacheKey,
          contentLength: cached.length,
          preview: previewText(cached).replace(/\n/g, "\\n"),
        });
        setRequestScopedFile(cacheKey, cached);
        return cached;
      }
    }

    // File list cache is enabled for BOTH preview and production modes.
    // The file list is an in-memory index built from API response at init, updated by WebSocket pokes.
    // This is safe because:
    // - File list is refreshed on every WebSocket poke (websocket-manager.ts:483-500)
    // - Request-scoped cache ensures consistency within a single render
    // - Persistent cache is only written for production mode (to avoid staleness risk in preview)
    const isPreviewMode = ctx?.sourceType === "branch";
    if (!skipPersistentCaches) {
      const fileListContent = await this.getContentFromFileList(normalizedPath);
      if (fileListContent) {
        logContentMetric("FILE_LIST_HIT", {
          path: normalizedPath,
          mode: ctx?.sourceType ?? "unknown",
          cacheKey,
          isPreviewMode,
        });
        // Only cache to persistent storage for production mode
        // Preview mode uses file list cache directly without persisting (fresher, WebSocket-driven)
        if (isProduction) {
          this.cache.set(cacheKey, fileListContent);
        }
        setRequestScopedFile(cacheKey, fileListContent);
        return fileListContent;
      }
    } else {
      // Skip only happens during cache invalidation (both preview and production)
      logContentMetric("PRODUCTION_SKIP_FILELIST", {
        path: normalizedPath,
        mode: ctx?.sourceType ?? "unknown",
        reason: "invalidation_in_progress",
      });
      logger.debug("[ReadOperations] Skipping file list cache due to invalidation", {
        path: normalizedPath,
        cacheKeyPrefix,
      });
    }

    if (!hasKnownExt) {
      try {
        const resolved = await this.client.resolveFileWithExtension(
          apiPath,
          [...EXTENSION_PRIORITY],
        );
        if (resolved) {
          const resolvedPath = this.normalizer.normalize(resolved.path);
          const resolvedCacheKey = `${cacheKeyPrefix}:${resolvedPath}`;

          logger.debug("[ReadOperations] Resolved extension for base path", {
            basePath: apiPath,
            resolvedPath,
            cacheKey,
            resolvedCacheKey: resolvedCacheKey === cacheKey ? undefined : resolvedCacheKey,
          });

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

    this.cleanupStaleInFlightRequests();

    const existingEntry = this.inFlightRequests.get(cacheKey);
    if (existingEntry) {
      logger.debug("[ReadOperations] Deduplicating request - joining existing fetch", {
        path: normalizedPath,
        cacheKey,
        ageMs: Date.now() - existingEntry.startedAt,
      });
      return existingEntry.promise;
    }

    const isPublished = ctx?.sourceType !== "branch";

    // THIS IS A NETWORK FETCH - every call here = API round trip
    // With caching enabled for preview mode, this should only happen on true cache misses
    logContentMetric("NETWORK_FETCH", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      isPublished,
      isPreviewMode,
      reason: "cache_miss",
    });

    logger.debug("[ReadOperations] fetchContent decision", {
      path: normalizedPath,
      isPublished,
      willFetch: isPublished ? "published (environment)" : "draft (branch)",
      sourceType: ctx?.sourceType ?? "null/undefined",
    });

    const fetchStartTime = performance.now();
    const fetchPromise = (async () => {
      try {
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

        // Record to production metrics system (histograms, counters)
        recordContentNetworkFetch(fetchDuration, isPreviewMode);

        logger.info("[ContentMetrics] NETWORK_FETCH_COMPLETE", {
          path: normalizedPath,
          mode: ctx?.sourceType ?? "unknown",
          duration_ms: fetchDuration,
          content_length: result.length,
          isPreviewMode,
        });

        return result;
      } finally {
        this.inFlightRequests.delete(cacheKey);
      }
    })();

    this.inFlightRequests.set(cacheKey, { promise: fetchPromise, startedAt: Date.now() });
    return fetchPromise;
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
      const result = await this.client.resolveFileWithExtension(basePath, [...EXTENSION_PRIORITY]);
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
