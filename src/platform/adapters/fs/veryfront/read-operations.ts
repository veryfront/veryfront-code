import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { logContentMetric, type MissReason } from "./content-metrics.ts";
import { FileListIndex, type FileListMatchResult } from "./file-list-index.ts";
import { InFlightRequestDeduper } from "./in-flight-dedupe.ts";
import { getRequestScopedFile, setRequestScopedFile } from "./request-context.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import type { ContentContextProvider } from "./file-list-access.ts";
import {
  assertProjectSourcePath,
  buildExtensionCandidatePaths,
  buildReadFetchState,
  createNotFoundLikeError,
  getResolvedCacheKey,
  isNotFoundLikeError,
  READ_OPERATION_EXTENSION_PRIORITY as EXTENSION_PRIORITY,
  splitKnownFileExtension,
} from "./read-operations-helpers.ts";
import type { ResolvedContentContext } from "./types.ts";
import { classifyFilesystemError, withFilesystemSpan } from "./telemetry.ts";

export {
  endRequestMetrics,
  getContentMetricsSnapshot,
  resetContentMetrics,
  startRequestMetrics,
} from "./content-metrics.ts";

const logger = baseLogger.component("read-operations");

const IN_FLIGHT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_IN_FLIGHT_REQUESTS = 100;
const IN_FLIGHT_CLEANUP_INTERVAL_MS = 1_000;

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
    return withFilesystemSpan(
      "fs.veryfront.readFile",
      async () => {
        const normalizedPath = this.normalizer.normalize(path);
        const content = await this.fetchContent(normalizedPath);
        return new TextEncoder().encode(content);
      },
    );
  }

  readTextFile(path: string): Promise<string> {
    return withFilesystemSpan(
      "fs.veryfront.readTextFile",
      () => {
        const normalizedPath = this.normalizer.normalize(path);
        logger.debug("readTextFile called");
        return this.fetchContent(normalizedPath);
      },
    );
  }

  readOptionalTextFile(path: string): Promise<string> {
    return withFilesystemSpan(
      "fs.veryfront.readOptionalTextFile",
      async () => {
        const normalizedPath = this.normalizer.normalize(path);
        const apiPath = this.getOriginalApiPath?.(normalizedPath) ?? normalizedPath;
        logger.debug("readOptionalTextFile called");
        return await this.client.getOptionalFileContent(apiPath);
      },
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
      contentLength: requestCached.length,
    });
    return requestCached;
  }

  private async getProductionPersistentCacheHit(
    normalizedPath: string,
    _cacheKeyPrefix: string,
    cacheKey: string,
    isProduction: boolean,
    skipPersistentCaches: boolean,
    _releaseId: string | null | undefined,
    isPrefixInvalidated: boolean,
    ctx: ResolvedContentContext | null,
  ): Promise<string | null> {
    if (isProduction && skipPersistentCaches) {
      logger.info("PERSISTENT_CACHE_SKIPPED - cache invalidation in progress", {
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
      contentLength: cached.length,
    });
    setRequestScopedFile(cacheKey, cached);
    return cached;
  }

  private async getFileListCacheHit(
    normalizedPath: string,
    _cacheKeyPrefix: string,
    cacheKey: string,
    isProduction: boolean,
    skipPersistentCaches: boolean,
    isPreviewMode: boolean,
    ctx: ResolvedContentContext | null,
  ): Promise<FileListMatchResult> {
    // File list cache is enabled for BOTH preview and production modes.
    // The file list is an in-memory index built from API response at init, updated by WebSocket pokes.
    // This is safe because:
    // - File list is refreshed on every WebSocket poke (websocket-manager.ts:483-500)
    // - Request-scoped cache ensures consistency within a single render
    // - Persistent cache is only written for production mode (to avoid staleness risk in preview)
    if (skipPersistentCaches) {
      logger.debug("Skipping file list cache due to invalidation");
      return { status: "unavailable", fresh: false };
    }

    const match = await this.fileListIndex.match(normalizedPath);
    if (match.status === "hit" && match.content) {
      logContentMetric("FILE_LIST_HIT", {
        path: normalizedPath,
        mode: ctx?.sourceType ?? "unknown",
        cacheKey,
        isPreviewMode,
      });
      // Only cache to persistent storage for production mode
      // Preview mode uses file list cache directly without persisting (fresher, WebSocket-driven)
      if (isProduction) {
        this.cache.set(cacheKey, match.content);
      }
      setRequestScopedFile(cacheKey, match.content);
    }

    return match;
  }

  private setupInFlightFetch(
    normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    isPublished: boolean,
    isProduction: boolean,
    isPreviewMode: boolean,
    ctx: ResolvedContentContext | null,
    missReason: MissReason,
  ): Promise<string> {
    const cleanupResult = this.inFlightRequests.cleanup();
    if (cleanupResult) {
      logger.warn("Cleaned up in-flight requests", cleanupResult);
    }

    const existingEntry = this.inFlightRequests.get(cacheKey);
    if (existingEntry) {
      logger.debug("Deduplicating request - joining existing fetch", {
        ageMs: Date.now() - existingEntry.startedAt,
      });
      return existingEntry.promise;
    }

    // Track why we're making a network fetch (for optimization analysis)
    logContentMetric("CACHE_MISS", {
      path: normalizedPath,
      mode: ctx?.sourceType ?? "unknown",
      missReason,
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
            hasResolvedPath: true,
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
      return this.finalizeResolvedExtension({
        requestedPath: apiPath,
        resolvedPath,
        cacheKeyPrefix,
        cacheKey,
        content: resolved.content,
        persistToCache: isProduction && !skipPersistentCaches,
        logMessage: "Resolved extension for base path",
      });
    } catch (error) {
      logger.debug("resolveFileWithExtension failed", {
        errorClass: classifyFilesystemError(error),
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
  ): Promise<FileListMatchResult> {
    const candidatePaths = buildExtensionCandidatePaths(normalizedPath);
    const resolved = await this.fileListIndex.findFirstMatch(candidatePaths);
    if (resolved.status !== "hit" || !resolved.path || !resolved.content) return resolved;

    logContentMetric("FILE_LIST_HIT", {
      path: normalizedPath,
      resolvedPath: resolved.path,
      mode: ctx?.sourceType ?? "unknown",
      cacheKey,
      isPreviewMode,
    });

    this.finalizeResolvedExtension({
      requestedPath: normalizedPath,
      resolvedPath: resolved.path,
      cacheKeyPrefix,
      cacheKey,
      content: resolved.content,
      persistToCache: isProduction,
      logMessage: "Resolved extension from file list index",
    });

    return resolved;
  }

  private finalizeResolvedExtension(
    {
      requestedPath,
      resolvedPath,
      cacheKeyPrefix,
      cacheKey,
      content,
      persistToCache,
      logMessage,
    }: {
      requestedPath: string;
      resolvedPath: string;
      cacheKeyPrefix: string;
      cacheKey: string;
      content: string;
      persistToCache: boolean;
      logMessage: string;
    },
  ): string {
    const resolvedCacheKey = getResolvedCacheKey(cacheKeyPrefix, resolvedPath);

    // Cache the path mapping to avoid future API resolution calls.
    this.extensionResolutionCache.set(requestedPath, resolvedPath);

    logger.debug(logMessage, {
      usesAlias: resolvedCacheKey !== cacheKey,
      persisted: persistToCache,
    });

    this.cacheResolvedContent(cacheKey, resolvedCacheKey, content, persistToCache);
    return content;
  }

  private cacheResolvedContent(
    cacheKey: string,
    resolvedCacheKey: string,
    content: string,
    persistToCache: boolean,
  ): void {
    if (persistToCache) {
      this.cache.set(cacheKey, content);
      if (resolvedCacheKey !== cacheKey) this.cache.set(resolvedCacheKey, content);
    }
    setRequestScopedFile(cacheKey, content);
    if (resolvedCacheKey !== cacheKey) {
      setRequestScopedFile(resolvedCacheKey, content);
    }
  }

  private storeFetchedContent(
    cacheKey: string,
    content: string,
    shouldCache: boolean,
  ): string {
    if (shouldCache) this.cache.set(cacheKey, content);
    setRequestScopedFile(cacheKey, content);
    return content;
  }

  private fetchPublishedVariant(
    apiPath: string,
    releaseId: string | null,
    environmentName?: string | null,
  ): Promise<string> {
    return this.client.getPublishedFileContent(
      apiPath,
      releaseId ?? undefined,
      environmentName ?? undefined,
    );
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
      hasContextProvider: !!this.contextProvider,
      hasContext: !!ctx,
      sourceType: ctx?.sourceType,
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

    const fileListMatch = await this.getFileListCacheHit(
      normalizedPath,
      cacheKeyPrefix,
      cacheKey,
      isProduction,
      skipPersistentCaches,
      isPreviewMode,
      ctx,
    );
    if (fileListMatch.status === "hit" && fileListMatch.content) return fileListMatch.content;
    if (fileListMatch.status === "present_without_content") {
      return this.setupInFlightFetch(
        normalizedPath,
        apiPath,
        cacheKey,
        isPublished,
        isProduction,
        isPreviewMode,
        ctx,
        "indexed_without_content",
      );
    }

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
        if (resolvedFromFileList.status === "hit" && resolvedFromFileList.content) {
          return resolvedFromFileList.content;
        }

        if (
          resolvedFromFileList.status === "present_without_content" &&
          resolvedFromFileList.path
        ) {
          const resolvedCacheKey = getResolvedCacheKey(cacheKeyPrefix, resolvedFromFileList.path);
          const resolvedApiPath = this.getOriginalApiPath?.(resolvedFromFileList.path) ??
            resolvedFromFileList.path;
          const fetchedResolved = await this.setupInFlightFetch(
            resolvedFromFileList.path,
            resolvedApiPath,
            resolvedCacheKey,
            isPublished,
            isProduction,
            isPreviewMode,
            ctx,
            "indexed_without_content",
          );

          this.extensionResolutionCache.set(normalizedPath, resolvedFromFileList.path);
          this.cacheResolvedContent(
            cacheKey,
            resolvedCacheKey,
            fetchedResolved,
            isProduction && !skipPersistentCaches,
          );

          return fetchedResolved;
        }

        if (
          fileListMatch.status === "missing" &&
          fileListMatch.fresh &&
          resolvedFromFileList.status === "missing" &&
          resolvedFromFileList.fresh
        ) {
          throw createNotFoundLikeError(normalizedPath);
        }
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

    if (fileListMatch.status === "missing" && fileListMatch.fresh) {
      throw createNotFoundLikeError(normalizedPath);
    }

    return this.setupInFlightFetch(
      normalizedPath,
      apiPath,
      cacheKey,
      isPublished,
      isProduction,
      isPreviewMode,
      ctx,
      skipPersistentCaches
        ? "invalidation"
        : fileListMatch.status === "missing" && fileListMatch.fresh
        ? "not_in_filelist"
        : "no_filelist_cache",
    );
  }

  private async fetchPublishedContent(
    _normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    releaseId: string | null,
    environmentName: string | null,
    shouldCache: boolean,
  ): Promise<string> {
    logger.debug("Fetching published content", {
      hasRelease: !!releaseId,
      hasEnvironment: !!environmentName,
    });

    try {
      const content = await this.fetchPublishedVariant(apiPath, releaseId, environmentName);

      logger.debug("Fetched published content", {
        contentLength: content.length,
      });

      return this.storeFetchedContent(cacheKey, content, shouldCache);
    } catch (error) {
      const is404Error = isNotFoundLikeError(error);

      if (!is404Error) {
        logger.error("Failed to fetch published content", {
          errorClass: classifyFilesystemError(error),
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

      logger.debug("File not found (expected for optional files)");
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

    logger.debug("Searching for file with extension pattern");

    try {
      const result = await this.client.resolveFileWithExtension(basePath, [...EXTENSION_PRIORITY]);
      if (!result) return null;

      logger.debug("Pattern search found file", {
        contentLength: result.content.length,
      });

      return this.storeFetchedContent(cacheKey, result.content, shouldCache);
    } catch (error) {
      logger.debug("Pattern search failed, trying sequential fallback", {
        errorClass: classifyFilesystemError(error),
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
    _apiPath: string,
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
      const content = await this.fetchPublishedVariant(basePath + ext, releaseId, environmentName);
      return content;
    });

    // Mark all promises as handled to prevent unhandled rejection errors
    // when we return early after a high-priority success (skipping lower-priority promises).
    for (const p of promises) {
      p.catch((err) => {
        logger.debug("Fallback attempt failed", {
          errorClass: classifyFilesystemError(err),
        });
      });
    }

    // Await in priority order: return as soon as highest-priority succeeds
    for (const promise of promises) {
      try {
        const content = await promise;
        const durationMs = Math.round(performance.now() - startTime);

        logger.debug("Parallel fallback succeeded", {
          contentLength: content.length,
          durationMs,
          candidateCount: candidates.length,
        });

        return this.storeFetchedContent(cacheKey, content, shouldCache);
      } catch (_) {
        /* expected: this extension variant does not exist, try next priority */
        continue;
      }
    }

    return null;
  }

  private async fetchDraftContent(
    _normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    shouldCache: boolean,
  ): Promise<string> {
    logger.debug("API_FETCH_START - fetching draft from API");

    const content = await this.client.getFileContent(apiPath);

    logger.debug("API_FETCH_DONE - got content from API", {
      contentLength: content.length,
      willCache: shouldCache,
    });

    return this.storeFetchedContent(cacheKey, content, shouldCache);
  }
}
