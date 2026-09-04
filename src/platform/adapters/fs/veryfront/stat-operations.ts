import { logger as baseLogger } from "#veryfront/utils";
import { isFrameworkSourcePath } from "#veryfront/utils/path-utils.ts";
import type { FileInfo, ResolveFileOptions } from "../../base.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { VeryfrontOperationsBase } from "./base-operations.ts";
import { createError, FILE_NOT_FOUND, fromError, toError, VeryfrontError } from "#veryfront/errors";
import { buildStatCacheKeyPrefix } from "./cache-keys.ts";
import { STAT_OPERATION_EXTENSION_PRIORITY as EXTENSION_PRIORITY } from "./extension-priority.ts";
import {
  collectParentDirectories,
  normalizeIndexedFilePath,
  resolveByExtensionPriority,
  resolveIndexByExtensionPriority,
  sortPathsByExtensionPriority,
  stripKnownExtension,
} from "./stat-operations-helpers.ts";
import { ApiSearchCircuitBreaker } from "./api-search-circuit-breaker.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { loadAllProjectFiles } from "./file-list-access.ts";
import type { ResolvedContentContext } from "./types.ts";
import { toClientContext } from "./adapter-content-context.ts";

const logger = baseLogger.component("stat-operations");

const NOT_FOUND_SENTINEL = "__NOT_FOUND__";

const API_SEARCH_CIRCUIT_BREAKER_THRESHOLD = 5;
const API_SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

/**
 * How long a built index may keep answering "absent" on its own authority.
 * Every invalidation path clears the index, so this only bounds the damage of
 * a poke that never arrived -- the same safety net FileListIndex applies to
 * the read path.
 */
const INDEX_AUTHORITY_LIMIT_MS = 5 * 60 * 1000;

interface StatIndexSnapshot {
  fileIndex: Map<string, ProjectFile>;
  directoryIndex: Set<string>;
  pathMapping: Map<string, string>;
  builtAt: number;
}

function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof VeryfrontError && error.slug === "file-not-found") {
    return true;
  }

  const veryfrontError = fromError(error);
  return veryfrontError?.type === "file" && veryfrontError.message.startsWith("File not found:");
}

export class StatOperations extends VeryfrontOperationsBase {
  private fileIndex: Map<string, ProjectFile> | null = null;
  private directoryIndex: Set<string> | null = null;
  private buildingIndex: Promise<StatIndexSnapshot> | null = null;
  private buildingIndexScopeKey: string | null = null;
  private indexScopeKey: string | null = null;
  private indexGeneration = 0;
  private indexBuiltAt = 0;

  private pathMapping: Map<string, string> = new Map();

  private readonly apiSearchCircuitBreaker = new ApiSearchCircuitBreaker({
    threshold: API_SEARCH_CIRCUIT_BREAKER_THRESHOLD,
    cooldownMs: API_SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS,
  });

  stat(path: string): Promise<FileInfo> {
    return withSpan("fs.veryfront.stat", () => this.statWithoutSpan(path), { "fs.path": path });
  }

  private async statWithoutSpan(path: string): Promise<FileInfo> {
    const normalizedPath = this.normalizer.normalize(path);
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = `${buildStatCacheKeyPrefix(ctx)}:${normalizedPath}`;

    logger.debug("stat called", { path, normalizedPath, cacheKey });

    const snapshot = await this.ensureIndexBuilt(ctx);

    const fileIdx = snapshot.fileIndex;
    const dirIdx = snapshot.directoryIndex;

    if (!fileIdx || !dirIdx) {
      logger.debug("stat - no index available", { normalizedPath });
      throw toError(
        createError({
          type: "file",
          message: `Index not available for: ${normalizedPath}`,
        }),
      );
    }

    const file = fileIdx.get(normalizedPath);
    if (file) {
      logger.debug("stat found file", { normalizedPath });
      return {
        size: file.size,
        mtime: new Date(file.updated_at),
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      };
    }

    if (dirIdx.has(normalizedPath)) {
      logger.debug("stat found directory", { normalizedPath });
      return {
        size: 0,
        mtime: new Date(),
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      };
    }

    // File not in index - try API pattern search as fallback for project files
    // Skip for framework paths (node_modules, _veryfront, etc.) and whenever
    // the index is the authoritative listing for this snapshot: it has already
    // answered, and asking again costs one file-listing request per probe.
    if (
      !this.isIndexAuthoritative() && !isFrameworkSourcePath(normalizedPath) &&
      this.apiSearchCircuitBreaker.canSearch()
    ) {
      const hasKnownExt = EXTENSION_PRIORITY.some((ext) => normalizedPath.endsWith(ext));
      if (hasKnownExt) {
        logger.debug("stat file not in index, trying API search", {
          normalizedPath,
          indexSize: fileIdx.size,
        });

        try {
          // Search for the exact file path
          const matches = await this.client.searchFiles(normalizedPath);
          this.apiSearchCircuitBreaker.recordSuccess();

          const exactMatch = matches.find((m) => m.path === normalizedPath);
          if (exactMatch) {
            logger.debug("stat found via API search", { normalizedPath });
            // Add to index for future lookups
            fileIdx.set(normalizedPath, {
              id: exactMatch.id,
              version_id: undefined,
              path: normalizedPath,
              content: undefined,
              type: "file",
              size: 0,
              updated_at: new Date().toISOString(),
            });
            return {
              size: 0,
              mtime: new Date(),
              isDirectory: false,
              isFile: true,
              isSymlink: false,
            };
          }
        } catch (error) {
          const result = this.apiSearchCircuitBreaker.recordFailure();
          if (result.tripped) {
            logger.warn("stat API search circuit breaker tripped", {
              failures: result.failures,
            });
          }
          logger.debug("stat API search failed", {
            normalizedPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    logger.debug("stat file not found (not in index)", {
      normalizedPath,
      indexSize: fileIdx.size,
    });
    throw FILE_NOT_FOUND.create({
      detail: `File not found: ${normalizedPath}`,
      context: { path: normalizedPath },
    });
  }

  private async ensureIndexBuilt(
    contentContext: ResolvedContentContext | null | undefined,
    rebuildsLeft = 1,
  ): Promise<StatIndexSnapshot> {
    const scopeKey = buildStatCacheKeyPrefix(contentContext);
    if (this.fileIndex && this.directoryIndex && this.indexScopeKey === scopeKey) {
      logger.debug("ensureIndexBuilt - index already built");
      return {
        fileIndex: this.fileIndex,
        directoryIndex: this.directoryIndex,
        pathMapping: this.pathMapping,
        builtAt: this.indexBuiltAt,
      };
    }

    if (this.buildingIndex) {
      logger.debug("ensureIndexBuilt - waiting for concurrent build");
      const waitStart = performance.now();
      const building = this.buildingIndex;
      const buildingScopeKey = this.buildingIndexScopeKey;
      const snapshot = await building;
      logger.debug("ensureIndexBuilt - concurrent build done", {
        waitMs: Math.round(performance.now() - waitStart),
      });
      if (buildingScopeKey === scopeKey) return snapshot;
      return await this.ensureIndexBuilt(contentContext, rebuildsLeft);
    }

    const generation = this.indexGeneration;
    const building = this.buildIndex(generation, contentContext, scopeKey);
    this.buildingIndex = building;
    this.buildingIndexScopeKey = scopeKey;
    let snapshot: StatIndexSnapshot;
    try {
      snapshot = await building;
    } finally {
      this.buildingIndex = null;
      this.buildingIndexScopeKey = null;
    }

    // A warmup that publishes the very listing this build asked for bumps the
    // index generation while the fetch is open, so `buildIndex` discards its
    // result instead of retaining it. Returning that orphan leaves
    // `isIndexAuthoritative()` false, and every later miss then pays an API
    // probe the listing could have answered. Rebuild once from the settled
    // snapshot; the listing is cached by then, so the retry costs no request.
    if (rebuildsLeft > 0 && this.indexScopeKey !== scopeKey) {
      logger.debug("ensureIndexBuilt - build superseded, rebuilding", { scopeKey });
      return await this.ensureIndexBuilt(contentContext, rebuildsLeft - 1);
    }

    return snapshot;
  }

  private async buildIndex(
    generation: number,
    contentContext: ResolvedContentContext | null | undefined,
    scopeKey: string,
  ): Promise<StatIndexSnapshot> {
    const buildStart = performance.now();
    logger.debug("buildIndex START");

    const fetchStart = performance.now();
    const allFiles = await this.getAllFilesRaw(contentContext);
    const fetchMs = Math.round(performance.now() - fetchStart);
    logger.debug("buildIndex - getAllFilesRaw done", {
      fetchMs,
      fileCount: allFiles.length,
    });

    const indexStart = performance.now();
    const fileIdx = new Map<string, ProjectFile>();
    const dirIdx = new Set<string>();
    const pathMap = new Map<string, string>();

    for (const file of allFiles) {
      const { normalizedPath, originalPath } = normalizeIndexedFilePath(file);
      if (originalPath) {
        pathMap.set(normalizedPath, originalPath);
        logger.debug("Normalized trailing slash path", {
          original: originalPath,
          normalized: normalizedPath,
        });
      }

      fileIdx.set(normalizedPath, file);

      for (const dir of collectParentDirectories(normalizedPath)) {
        dirIdx.add(dir);
      }
    }

    const builtAt = Date.now();
    const currentScopeKey = buildStatCacheKeyPrefix(this.contextProvider?.getContentContext());
    if (generation === this.indexGeneration && currentScopeKey === scopeKey) {
      this.fileIndex = fileIdx;
      this.directoryIndex = dirIdx;
      this.pathMapping = pathMap;
      this.indexBuiltAt = builtAt;
      this.indexScopeKey = scopeKey;
    }

    const indexMs = Math.round(performance.now() - indexStart);
    const totalMs = Math.round(performance.now() - buildStart);
    logger.debug("Index built", {
      files: fileIdx.size,
      directories: dirIdx.size,
      pathMappings: pathMap.size,
      fetchMs,
      indexMs,
      totalMs,
    });
    return { fileIndex: fileIdx, directoryIndex: dirIdx, pathMapping: pathMap, builtAt };
  }

  clearIndex(): void {
    this.indexGeneration += 1;
    this.fileIndex = null;
    this.directoryIndex = null;
    this.pathMapping.clear();
    this.indexBuiltAt = 0;
    this.indexScopeKey = null;
  }

  /**
   * Restart the authority window for the index already in memory, after the
   * API has confirmed the listing it was built from is still current.
   *
   * `INDEX_AUTHORITY_LIMIT_MS` bounds a poke that never arrived, so crossing
   * it has to cost one re-check -- not one per probe. A refresh that comes
   * back unchanged is exactly that re-check: it just compared this snapshot
   * against the API and found nothing new, which is stronger evidence than
   * the build that opened the window. Without renewing here the index stays
   * expired, and every distinct module probe pays its own refresh forever --
   * the fan-out this gate removes, returning after five minutes.
   *
   * This cannot become "never re-check again": only a completed refresh calls
   * it, so each renewal costs one verified listing fetch and the next window
   * expires on the same timer. An edit is still seen the moment its poke
   * lands, because `clearIndex` drops the index outright.
   */
  renewIndexAuthority(): void {
    if (!this.fileIndex || !this.directoryIndex) return;
    this.indexBuiltAt = Date.now();
  }

  /**
   * Whether the built index is the complete file listing for the snapshot
   * being rendered, and may therefore answer "this path does not exist"
   * without asking the API.
   *
   * The index is built from `loadAllProjectFiles`, the same listing that
   * serves every positive answer this render gives. A path missing from it is
   * missing from the snapshot, so re-asking the API for that exact path can
   * only re-derive the answer the index already holds -- which is what turned
   * one preview render into dozens of file-listing requests.
   *
   * This authority covers exact-path lookups only. `resolveFile`'s pattern
   * search still runs on a miss: it is the documented safety net for a listing
   * that came back incomplete, and it searches spellings the index was never
   * asked about.
   *
   * The authority lasts exactly as long as the index: every invalidation path
   * (`clearMemoryCaches`, snapshot replacement, token or branch change,
   * `dispose`) calls `clearIndex`, so an edit can never be answered from a
   * pre-edit listing.
   */
  isIndexAuthoritative(): boolean {
    if (!this.fileIndex || !this.directoryIndex) return false;
    return Date.now() - this.indexBuiltAt < INDEX_AUTHORITY_LIMIT_MS;
  }

  getOriginalApiPath(normalizedPath: string): string {
    return this.pathMapping.get(normalizedPath) ?? normalizedPath;
  }

  private async getAllFilesRaw(
    contentContext: ResolvedContentContext | null | undefined,
  ): Promise<ProjectFile[]> {
    return await loadAllProjectFiles({
      client: this.client,
      cache: this.cache,
      contextProvider: this.contextProvider,
      logger,
      operationLabel: "stat",
      contentContext,
    });
  }

  private buildResolveSearchPatterns(
    normalizedPath: string,
    options?: ResolveFileOptions,
    knownExtensionFallback: "exact" | "wildcard" = "exact",
  ): string[] {
    const patterns = new Set<string>();
    const pathWithoutExt = stripKnownExtension(normalizedPath, EXTENSION_PRIORITY);
    const allowPagesPrefix = options?.allowPagesPrefix !== false;
    const addPattern = (pattern: string): void => {
      if (pattern.length > 0) patterns.add(pattern);
    };

    if (EXTENSION_PRIORITY.some((ext) => normalizedPath.endsWith(ext))) {
      addPattern(
        knownExtensionFallback === "wildcard" ? `${pathWithoutExt}.*` : normalizedPath,
      );
      return [...patterns];
    }

    addPattern(`${pathWithoutExt}.*`);
    if (allowPagesPrefix && !pathWithoutExt.startsWith("pages/")) {
      addPattern(`pages/${pathWithoutExt}.*`);
    }

    addPattern(`${pathWithoutExt}/index.*`);
    if (allowPagesPrefix && !pathWithoutExt.startsWith("pages/")) {
      addPattern(`pages/${pathWithoutExt}/index.*`);
    }

    return [...patterns];
  }

  private normalizeMatchedPaths(
    matches: Array<{ path: string }>,
  ): Array<{ path: string }> {
    return matches.map((match) => ({
      path: normalizeIndexedFilePath(match as ProjectFile).normalizedPath,
    }));
  }

  private async tryResolveViaApiSearch(
    normalizedPath: string,
    options?: ResolveFileOptions,
    contentContext?: ResolvedContentContext | null,
    knownExtensionFallback: "exact" | "wildcard" = "exact",
  ): Promise<string | null | undefined> {
    if (isFrameworkSourcePath(normalizedPath)) {
      logger.debug("Skipping API search for framework path", { normalizedPath });
      return null;
    }

    if (!this.apiSearchCircuitBreaker.canSearch()) {
      logger.warn("API search circuit breaker open, skipping", { normalizedPath });
      return undefined;
    }

    const patterns = this.buildResolveSearchPatterns(
      normalizedPath,
      options,
      knownExtensionFallback,
    );
    let sawSuccessfulSearch = false;

    for (const pattern of patterns) {
      try {
        const matches = await this.client.searchFiles(
          pattern,
          contentContext ? toClientContext(contentContext) : undefined,
        );
        sawSuccessfulSearch = true;
        this.apiSearchCircuitBreaker.recordSuccess();

        const normalizedMatches = this.normalizeMatchedPaths(matches);
        if (pattern === normalizedPath) {
          const exactMatch = normalizedMatches.find((match) => match.path === normalizedPath);
          if (exactMatch) {
            logger.debug("resolveFile found exact file via API search", {
              normalizedPath,
              pattern,
            });
            return exactMatch.path;
          }
          continue;
        }

        const sortedMatches = sortPathsByExtensionPriority(normalizedMatches, EXTENSION_PRIORITY);
        const first = sortedMatches[0];
        if (first) {
          logger.debug("resolveFile found via API search", {
            normalizedPath,
            pattern,
            resolvedPath: first.path,
          });
          return first.path;
        }
      } catch (error) {
        const result = this.apiSearchCircuitBreaker.recordFailure();
        if (result.tripped) {
          logger.warn("API search circuit breaker tripped", {
            failures: result.failures,
          });
          return undefined;
        }
        logger.error("API pattern search failed", { pattern, error });
      }

      if (!this.apiSearchCircuitBreaker.canSearch()) {
        logger.warn("API search circuit breaker open, aborting remaining patterns", {
          normalizedPath,
        });
        return undefined;
      }
    }

    if (sawSuccessfulSearch) {
      logger.debug("resolveFile not found via API search", { normalizedPath, patterns });
      return null;
    }

    return undefined;
  }

  private async hasCachedFileList(): Promise<boolean> {
    if (this.contextProvider?.hasCachedFileList) {
      return await this.contextProvider.hasCachedFileList();
    }

    const files = await this.contextProvider?.getFileList?.();
    return Array.isArray(files);
  }

  private resolveFromIndex(
    fileIdx: Map<string, ProjectFile>,
    normalizedPath: string,
    options: ResolveFileOptions | undefined,
    indexMs: number,
    resolveStart: number,
  ): string | null {
    if (fileIdx.has(normalizedPath)) {
      const totalMs = Math.round(performance.now() - resolveStart);
      logger.debug("resolveFile exact match found", {
        normalizedPath,
        indexMs,
        totalMs,
      });
      return normalizedPath;
    }

    const pathWithoutExt = stripKnownExtension(normalizedPath, EXTENSION_PRIORITY);

    const resolvedDirect = resolveByExtensionPriority(fileIdx, pathWithoutExt, EXTENSION_PRIORITY);
    if (resolvedDirect) {
      const totalMs = Math.round(performance.now() - resolveStart);
      logger.debug("resolveFile found with extension", {
        pathWithExt: resolvedDirect,
        indexMs,
        totalMs,
      });
      return resolvedDirect;
    }

    if (options?.allowPagesPrefix !== false && !pathWithoutExt.startsWith("pages/")) {
      const resolvedPages = resolveByExtensionPriority(
        fileIdx,
        `pages/${pathWithoutExt}`,
        EXTENSION_PRIORITY,
      );
      if (resolvedPages) {
        const totalMs = Math.round(performance.now() - resolveStart);
        logger.debug("resolveFile found with pages prefix", {
          pathWithExt: resolvedPages,
          indexMs,
          totalMs,
        });
        return resolvedPages;
      }
    }

    const indexPath = resolveIndexByExtensionPriority(fileIdx, pathWithoutExt, EXTENSION_PRIORITY);
    if (indexPath) {
      const totalMs = Math.round(performance.now() - resolveStart);
      logger.debug("resolveFile found index file", {
        indexPath,
        indexMs,
        totalMs,
      });
      return indexPath;
    }

    return null;
  }

  async exists(path: string): Promise<boolean> {
    return withSpan(
      "fs.veryfront.exists",
      async () => {
        try {
          await this.statWithoutSpan(path);
          return true;
        } catch (error) {
          if (isFileNotFoundError(error)) {
            return false;
          }
          throw error;
        }
      },
      { "fs.path": path },
    );
  }

  async resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    const resolveStart = performance.now();
    const normalizedPath = this.normalizer.normalize(basePath);
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = `${buildStatCacheKeyPrefix(ctx)}:resolve:${normalizedPath}`;

    logger.debug("resolveFile called", {
      basePath,
      normalizedPath,
      cacheKey,
    });

    const cached = await this.cache.getAsync<string>(cacheKey);
    if (cached === NOT_FOUND_SENTINEL) {
      logger.debug("resolveFile cached negative result", { normalizedPath });
      return null;
    }

    if (cached !== undefined) {
      logger.debug("resolveFile cache hit", {
        normalizedPath,
        cached,
      });
      return cached;
    }

    const hasCachedFileList = await this.hasCachedFileList();
    const attemptedApiResolve = !hasCachedFileList;

    if (!hasCachedFileList) {
      const apiResolved = await this.tryResolveViaApiSearch(normalizedPath, options, ctx);
      if (typeof apiResolved === "string") {
        this.cache.set(cacheKey, apiResolved);
        return apiResolved;
      }

      if (apiResolved === null) {
        this.cache.set(cacheKey, NOT_FOUND_SENTINEL);
        return null;
      }
    }

    const indexStart = performance.now();
    const snapshot = await this.ensureIndexBuilt(ctx);
    const indexMs = Math.round(performance.now() - indexStart);

    const fileIdx = snapshot.fileIndex;
    if (!fileIdx) {
      logger.debug("resolveFile - no file index", { indexMs });
      return null;
    }

    const indexedResolution = this.resolveFromIndex(
      fileIdx,
      normalizedPath,
      options,
      indexMs,
      resolveStart,
    );
    if (indexedResolution) {
      return indexedResolution;
    }

    if (hasCachedFileList && fileIdx.size === 0) {
      logger.debug("resolveFile not found in authoritative empty file list", {
        normalizedPath,
        indexMs,
      });
      this.cache.set(cacheKey, NOT_FOUND_SENTINEL);
      return null;
    }

    if (attemptedApiResolve) {
      logger.debug("resolveFile not found after pre-index API search", {
        normalizedPath,
        indexMs,
      });
      this.cache.set(cacheKey, NOT_FOUND_SENTINEL);
      return null;
    }

    if (isFrameworkSourcePath(normalizedPath)) {
      logger.debug("Skipping API search for framework path", { normalizedPath });
      return null;
    }

    // NOTE: Keep the post-index API fallback aligned with the pre-index helper for extensionless
    // paths, while preserving the older wildcard sibling-extension lookup for known-extension
    // paths. Incomplete file-list snapshots otherwise hide valid files until the cache refreshes.
    const apiResolved = await this.tryResolveViaApiSearch(
      normalizedPath,
      options,
      ctx,
      "wildcard",
    );
    if (typeof apiResolved === "string") {
      this.cache.set(cacheKey, apiResolved);
      return apiResolved;
    }
    if (apiResolved === null) {
      this.cache.set(cacheKey, NOT_FOUND_SENTINEL);
    }
    return null;
  }
}
