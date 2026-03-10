import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { logContentMetric, type MissReason } from "./content-metrics.ts";
import { FileListIndex } from "./file-list-index.ts";
import { InFlightRequestDeduper } from "./in-flight-dedupe.ts";
import { getRequestScopedFile, setRequestScopedFile } from "./multi-project-adapter.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import {
  assertProjectSourcePath,
  buildReadFetchState,
  getResolvedCacheKey,
  isNotFoundLikeError,
  READ_OPERATION_EXTENSION_PRIORITY as EXTENSION_PRIORITY,
  splitKnownFileExtension,
} from "./read-operations-helpers.ts";
import type { ResolvedContentContext } from "./types.ts";

export {
  endRequestMetrics,
  getContentMetricsSnapshot,
  resetContentMetrics,
  startRequestMetrics,
} from "./content-metrics.ts";

const logger = baseLogger.component("read-operations");

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

const IN_FLIGHT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_IN_FLIGHT_REQUESTS = 100;
const IN_FLIGHT_CLEANUP_INTERVAL_MS = 1_000;

function previewText(content: string, max = 80): string {
  return content.length > max ? `${content.slice(0, max)}...` : content;
}

export class ReadOperations {
  private readonly inFlightRequests = new InFlightRequestDeduper<string>({
    timeoutMs: IN_FLIGHT_REQUEST_TIMEOUT_MS,
    maxEntries: MAX_IN_FLIGHT_REQUESTS,
    cleanupIntervalMs: IN_FLIGHT_CLEANUP_INTERVAL_MS,
  });
  private readonly fileListIndex: FileListIndex;
  /** Caches extensionless base paths → resolved full paths to avoid repeated API resolution calls */
  private readonly extensionResolutionCache = new Map<string, string>();

  constructor(
    private readonly client: VeryfrontApiClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
    private readonly contextProvider?: ContentContextProvider,
    private readonly getOriginalApiPath?: (path: string) => string,
    private readonly getFileListCache?: () => Promise<
      Array<{ path: string; content?: string }> | undefined
    >,
  ) {
    this.fileListIndex = new FileListIndex(this.getFileListCache);
  }

  setFileListReadyPromise(promise: Promise<void>): void {
    this.fileListIndex.setReadyPromise(promise);
  }

  clearFileListIndex(): void {
    this.fileListIndex.clear();
    this.extensionResolutionCache.clear();
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
        logger.debug("readTextFile called", { path, normalizedPath });
        return this.fetchContent(normalizedPath);
      },
      { "fs.path": path },
    );
  }

  private getRequestScopedHit(
    normalizedPath: string,
    cacheKey: string,
    ctx: ResolvedContentContext | null,
  ): string | null {
    const requestCached = getRequestScopedFile(cacheKey);
    if (!requestCached) return null;

    logContentMetric("REQUEST_SCOPED_HIT", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      cacheKey,
    });
    logger.debug("REQUEST_CACHE_HIT", {
      path: normalizedPath,
      cacheKey,
      contentLength: requestCached.length,
      preview: previewText(requestCached).replace(/\n/g, "\\n"),
    });
    return requestCached;
  }

  private async getProductionPersistentCacheHit(
    normalizedPath: string,
    cacheKeyPrefix: string,
    cacheKey: string,
    isProduction: boolean,
    skipPersistentCaches: boolean,
    releaseId: string | null | undefined,
    isPrefixInvalidated: boolean,
    ctx: ResolvedContentContext | null,
  ): Promise<string | null> {
    if (isProduction && skipPersistentCaches) {
      logger.info("PERSISTENT_CACHE_SKIPPED - cache invalidation in progress", {
        path: normalizedPath,
        cacheKey,
        cacheKeyPrefix,
        releaseId: releaseId ?? undefined,
        prefixInvalidated: isPrefixInvalidated,
      });
    }

    // Check persistent cache for PRODUCTION mode only
    // Preview mode skips persistent cache to avoid staleness risk when WebSocket is slow/disconnected
    if (!isProduction || skipPersistentCaches) return null;

    const cached = await this.cache.getAsync<string>(cacheKey);
    if (!cached) return null;

    logContentMetric("PERSISTENT_CACHE_HIT", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      cacheKey,
    });
    logger.debug("PERSISTENT_CACHE_HIT", {
      path: normalizedPath,
      cacheKey,
      contentLength: cached.length,
      preview: previewText(cached).replace(/\n/g, "\\n"),
    });
    setRequestScopedFile(cacheKey, cached);
    return cached;
  }

  private async getFileListCacheHit(
    normalizedPath: string,
    cacheKeyPrefix: string,
    cacheKey: string,
    isProduction: boolean,
    skipPersistentCaches: boolean,
    isPreviewMode: boolean,
    ctx: ResolvedContentContext | null,
  ): Promise<string | null> {
    // File list cache is enabled for BOTH preview and production modes.
    // The file list is an in-memory index built from API response at init, updated by WebSocket pokes.
    // This is safe because:
    // - File list is refreshed on every WebSocket poke (websocket-manager.ts:483-500)
    // - Request-scoped cache ensures consistency within a single render
    // - Persistent cache is only written for production mode (to avoid staleness risk in preview)
    if (!skipPersistentCaches) {
      const fileListContent = await this.fileListIndex.lookup(normalizedPath);
      if (!fileListContent) return null;

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

    // Skip only happens during cache invalidation (both preview and production)
    logContentMetric("CACHE_MISS", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      missReason: "invalidation" as MissReason,
      isPreviewMode,
    });
    logger.debug("Skipping file list cache due to invalidation", {
      path: normalizedPath,
      cacheKeyPrefix,
    });
    return null;
  }

  private setupInFlightFetch(
    normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    isPublished: boolean,
    isProduction: boolean,
    isPreviewMode: boolean,
    ctx: ResolvedContentContext | null,
  ): Promise<string> {
    const cleanupResult = this.inFlightRequests.cleanup();
    if (cleanupResult) {
      logger.warn("Cleaned up in-flight requests", cleanupResult);
    }

    const existingEntry = this.inFlightRequests.get(cacheKey);
    if (existingEntry) {
      logger.debug("Deduplicating request - joining existing fetch", {
        path: normalizedPath,
        cacheKey,
        ageMs: Date.now() - existingEntry.startedAt,
      });
      return existingEntry.promise;
    }

    // Track why we're making a network fetch (for optimization analysis)
    const hasFileListCache = !!this.getFileListCache;
    logContentMetric("CACHE_MISS", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      missReason: (hasFileListCache ? "not_in_filelist" : "no_filelist_cache") as MissReason,
      isPreviewMode,
    });

    // THIS IS A NETWORK FETCH - every call here = API round trip
    // With caching enabled for preview mode, this should only happen on true cache misses
    logContentMetric("NETWORK_FETCH", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      isPublished,
      isPreviewMode,
    });

    logger.debug("fetchContent decision", {
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

        // Record fetch completion with timing for per-request metrics
        logContentMetric("NETWORK_FETCH_COMPLETE", {
          path: normalizedPath,
          mode: ctx?.sourceType ?? "unknown",
          durationMs: fetchDuration,
          contentLength: result.length,
          isPreviewMode,
        });

        return result;
      } finally {
        this.inFlightRequests.delete(cacheKey);
      }
    })();

    this.inFlightRequests.set(cacheKey, fetchPromise, Date.now());
    return fetchPromise;
  }

  private async tryResolveExtensionlessPath(
    apiPath: string,
    cacheKeyPrefix: string,
    cacheKey: string,
    isProduction: boolean,
    skipPersistentCaches: boolean,
  ): Promise<string | null> {
    // Check extension resolution cache first to skip the API call entirely.
    // Once we know pages/home → pages/home.tsx, we never need to ask the API again.
    if (!skipPersistentCaches) {
      const cachedResolvedPath = this.extensionResolutionCache.get(apiPath);
      if (cachedResolvedPath) {
        const resolvedCacheKey = getResolvedCacheKey(cacheKeyPrefix, cachedResolvedPath);
        const cached = this.cache.get<string>(resolvedCacheKey) ?? this.cache.get<string>(cacheKey);
        if (cached) {
          logger.debug("Extension resolution cache hit", {
            basePath: apiPath,
            resolvedPath: cachedResolvedPath,
          });
          setRequestScopedFile(cacheKey, cached);
          return cached;
        }
      }
    }

    try {
      const resolved = await this.client.resolveFileWithExtension(
        apiPath,
        [...EXTENSION_PRIORITY],
      );
      if (!resolved) return null;

      const resolvedPath = this.normalizer.normalize(resolved.path);
      const resolvedCacheKey = getResolvedCacheKey(cacheKeyPrefix, resolvedPath);

      // Cache the path mapping to avoid future API resolution calls
      this.extensionResolutionCache.set(apiPath, resolvedPath);

      logger.debug("Resolved extension for base path", {
        basePath: apiPath,
        resolvedPath,
        cacheKey,
        resolvedCacheKey: resolvedCacheKey === cacheKey ? undefined : resolvedCacheKey,
      });

      if (isProduction && !skipPersistentCaches) {
        this.cache.set(cacheKey, resolved.content);
        if (resolvedCacheKey !== cacheKey) this.cache.set(resolvedCacheKey, resolved.content);
      }

      setRequestScopedFile(cacheKey, resolved.content);
      if (resolvedCacheKey !== cacheKey) {
        setRequestScopedFile(resolvedCacheKey, resolved.content);
      }

      return resolved.content;
    } catch (error) {
      logger.debug("resolveFileWithExtension failed", {
        basePath: apiPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async tryResolveExtensionlessPathFromFileList(
    normalizedPath: string,
    cacheKeyPrefix: string,
    cacheKey: string,
    isProduction: boolean,
    ctx: ResolvedContentContext | null,
    isPreviewMode: boolean,
  ): Promise<string | null> {
    const candidatePaths = EXTENSION_PRIORITY.map((ext) => `${normalizedPath}${ext}`);
    const resolved = await this.fileListIndex.findFirstWithContent(candidatePaths);
    if (!resolved) return null;

    const resolvedCacheKey = getResolvedCacheKey(cacheKeyPrefix, resolved.path);

    this.extensionResolutionCache.set(normalizedPath, resolved.path);

    logContentMetric("FILE_LIST_HIT", {
      path: normalizedPath,
      resolvedPath: resolved.path,
      mode: ctx?.sourceType ?? "unknown",
      cacheKey,
      isPreviewMode,
    });
    logger.debug("Resolved extension from file list index", {
      basePath: normalizedPath,
      resolvedPath: resolved.path,
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

  private async fetchContent(normalizedPath: string): Promise<string> {
    // Framework paths should NEVER be fetched from API - they must be read from local filesystem.
    // If we reach here for a framework path, the module server's local resolution failed.
    assertProjectSourcePath(normalizedPath);

    const ctx = this.contextProvider?.getContentContext() ?? null;
    const {
      apiPath,
      cacheKeyPrefix,
      cacheKey,
      isProduction,
      hasKnownExtension: hasKnownExt,
      isPreviewMode,
      isPublished,
      releaseId: currentReleaseId,
      isPrefixInvalidated,
      skipPersistentCaches,
    } = buildReadFetchState({
      normalizedPath,
      contentContext: ctx,
      contextProvider: this.contextProvider,
      getOriginalApiPath: this.getOriginalApiPath,
    });

    logger.debug("fetchContent context", {
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

    const requestCached = this.getRequestScopedHit(normalizedPath, cacheKey, ctx);
    if (requestCached) return requestCached;

    const persistentCached = await this.getProductionPersistentCacheHit(
      normalizedPath,
      cacheKeyPrefix,
      cacheKey,
      isProduction,
      skipPersistentCaches,
      currentReleaseId,
      isPrefixInvalidated,
      ctx,
    );
    if (persistentCached) return persistentCached;

    const fileListCached = await this.getFileListCacheHit(
      normalizedPath,
      cacheKeyPrefix,
      cacheKey,
      isProduction,
      skipPersistentCaches,
      isPreviewMode,
      ctx,
    );
    if (fileListCached) return fileListCached;

    if (!hasKnownExt) {
      if (!skipPersistentCaches) {
        const resolvedFromFileList = await this.tryResolveExtensionlessPathFromFileList(
          normalizedPath,
          cacheKeyPrefix,
          cacheKey,
          isProduction,
          ctx,
          isPreviewMode,
        );
        if (resolvedFromFileList) return resolvedFromFileList;
      }

      const resolved = await this.tryResolveExtensionlessPath(
        apiPath,
        cacheKeyPrefix,
        cacheKey,
        isProduction,
        skipPersistentCaches,
      );
      if (resolved) return resolved;
    }

    return this.setupInFlightFetch(
      normalizedPath,
      apiPath,
      cacheKey,
      isPublished,
      isProduction,
      isPreviewMode,
      ctx,
    );
  }

  private async fetchPublishedContent(
    normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    releaseId: string | null,
    environmentName: string | null,
    shouldCache: boolean,
  ): Promise<string> {
    logger.debug("Fetching published content", {
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

      logger.debug("Fetched published content", {
        path: normalizedPath,
        contentLength: content.length,
        releaseId,
      });

      if (shouldCache) this.cache.set(cacheKey, content);
      setRequestScopedFile(cacheKey, content);
      return content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const is404Error = isNotFoundLikeError(error);

      if (!is404Error) {
        logger.error("Failed to fetch published content", {
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

      logger.debug("File not found (expected for optional files)", {
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
    const pathParts = splitKnownFileExtension(apiPath);
    if (!pathParts) return null;

    const { originalExtension: originalExt, basePath } = pathParts;

    logger.debug("Searching for file with pattern", {
      originalPath: apiPath,
      pattern: `${basePath}.*`,
    });

    try {
      const result = await this.client.resolveFileWithExtension(basePath, [...EXTENSION_PRIORITY]);
      if (!result) return null;

      logger.debug("Pattern search found file", {
        originalPath: apiPath,
        foundPath: result.path,
        contentLength: result.content.length,
      });

      if (shouldCache) this.cache.set(cacheKey, result.content);
      setRequestScopedFile(cacheKey, result.content);
      return result.content;
    } catch (error) {
      logger.debug("Pattern search failed, trying sequential fallback", {
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
    // Start all extension fetches in parallel, but resolve in priority order.
    // This gives us parallel network initiation (no sequential round trips)
    // AND returns as soon as the highest-priority extension succeeds —
    // without waiting for slow lower-priority extensions to settle.
    const candidates = EXTENSION_PRIORITY.filter((ext) => ext !== originalExt);
    const startTime = performance.now();

    const promises = candidates.map(async (ext) => {
      const content = await this.client.getPublishedFileContent(
        basePath + ext,
        releaseId ?? undefined,
        environmentName ?? undefined,
      );
      return { ext, content };
    });

    // Mark all promises as handled to prevent unhandled rejection errors
    // when we return early after a high-priority success (skipping lower-priority promises).
    for (const p of promises) p.catch(() => {});

    // Await in priority order: return as soon as highest-priority succeeds
    for (const promise of promises) {
      try {
        const { ext, content } = await promise;
        const fallbackPath = basePath + ext;
        const durationMs = Math.round(performance.now() - startTime);

        logger.debug("Parallel fallback succeeded", {
          originalPath: apiPath,
          fallbackPath,
          contentLength: content.length,
          durationMs,
          candidateCount: candidates.length,
        });

        if (shouldCache) this.cache.set(cacheKey, content);
        setRequestScopedFile(cacheKey, content);
        return content;
      } catch (_) {
        /* expected: this extension variant does not exist, try next priority */
        continue;
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
    logger.debug("API_FETCH_START - fetching draft from API", {
      path: normalizedPath,
      apiPath,
      cacheKey,
    });

    const content = await this.client.getFileContent(apiPath);

    logger.debug("API_FETCH_DONE - got content from API", {
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
