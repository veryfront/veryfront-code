import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { isFrameworkSourcePath } from "#veryfront/utils/path-utils.ts";
import type { FileInfo, ResolveFileOptions } from "../../base.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { VeryfrontOperationsBase } from "./base-operations.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { createError, fromError, toError } from "#veryfront/errors/veryfront-error.ts";
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
import { loadAllProjectFiles } from "./file-list-access.ts";
import { classifyFilesystemError, withFilesystemSpan } from "./telemetry.ts";

const logger = baseLogger.component("stat-operations");

const NOT_FOUND_SENTINEL = "__NOT_FOUND__";

const API_SEARCH_CIRCUIT_BREAKER_THRESHOLD = 5;
const API_SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof VeryfrontError && error.slug === "file-not-found") {
    return true;
  }

  const veryfrontError = fromError(error);
  return veryfrontError?.type === "file" && veryfrontError.message.startsWith("File not found");
}

export class StatOperations extends VeryfrontOperationsBase {
  private fileIndex: Map<string, ProjectFile> | null = null;
  private directoryIndex: Set<string> | null = null;
  private buildingIndex: Promise<void> | null = null;

  private indexBuildLockResolver: (() => void) | null = null;
  private indexBuildLockPromise: Promise<void> | null = null;

  private pathMapping: Map<string, string> = new Map();

  private readonly apiSearchCircuitBreaker = new ApiSearchCircuitBreaker({
    threshold: API_SEARCH_CIRCUIT_BREAKER_THRESHOLD,
    cooldownMs: API_SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS,
  });

  stat(path: string): Promise<FileInfo> {
    return withFilesystemSpan("fs.veryfront.stat", () => this.statWithoutSpan(path));
  }

  private async statWithoutSpan(path: string): Promise<FileInfo> {
    const normalizedPath = this.normalizer.normalize(path);

    logger.debug("stat called");

    await this.ensureIndexBuilt();

    const fileIdx = this.fileIndex;
    const dirIdx = this.directoryIndex;

    if (!fileIdx || !dirIdx) {
      logger.debug("stat - no index available");
      throw toError(
        createError({
          type: "file",
          message: "File index is not available",
        }),
      );
    }

    const file = fileIdx.get(normalizedPath);
    if (file) {
      logger.debug("stat found file");
      return {
        size: file.size,
        mtime: new Date(file.updated_at),
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      };
    }

    if (dirIdx.has(normalizedPath)) {
      logger.debug("stat found directory");
      return {
        size: 0,
        mtime: new Date(),
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      };
    }

    // File not in index - try API pattern search as fallback for project files
    // Skip for framework paths (node_modules, _veryfront, etc.)
    if (!isFrameworkSourcePath(normalizedPath) && this.apiSearchCircuitBreaker.canSearch()) {
      const hasKnownExt = EXTENSION_PRIORITY.some((ext) => normalizedPath.endsWith(ext));
      if (hasKnownExt) {
        logger.debug("stat file not in index, trying API search", {
          indexSize: fileIdx.size,
        });

        try {
          // Search for the exact file path
          const matches = await this.client.searchFiles(normalizedPath);
          this.apiSearchCircuitBreaker.recordSuccess();

          const exactMatch = matches.find((m) => m.path === normalizedPath);
          if (exactMatch) {
            logger.debug("stat found via API search");
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
            errorClass: classifyFilesystemError(error),
          });
        }
      }
    }

    logger.debug("stat file not found (not in index)", {
      indexSize: fileIdx.size,
    });
    throw toError(
      createError({
        type: "file",
        message: "File not found",
      }),
    );
  }

  private async ensureIndexBuilt(): Promise<void> {
    if (this.fileIndex && this.directoryIndex) {
      logger.debug("ensureIndexBuilt - index already built");
      return;
    }

    if (this.buildingIndex) {
      logger.debug("ensureIndexBuilt - waiting for concurrent build");
      const waitStart = performance.now();
      await this.buildingIndex;
      logger.debug("ensureIndexBuilt - concurrent build done", {
        waitMs: Math.round(performance.now() - waitStart),
      });
      return;
    }

    if (this.indexBuildLockPromise) {
      logger.debug("ensureIndexBuilt - waiting for lock");
      await this.indexBuildLockPromise;
      if (this.buildingIndex) await this.buildingIndex;
      return;
    }

    this.indexBuildLockPromise = new Promise((resolve) => {
      this.indexBuildLockResolver = resolve;
    });

    try {
      if (this.fileIndex && this.directoryIndex) return;

      this.buildingIndex = this.buildIndex();
      await this.buildingIndex;
    } finally {
      this.buildingIndex = null;
      this.indexBuildLockResolver?.();
      this.indexBuildLockResolver = null;
      this.indexBuildLockPromise = null;
    }
  }

  private async buildIndex(): Promise<void> {
    const buildStart = performance.now();
    logger.debug("buildIndex START");

    const fetchStart = performance.now();
    const allFiles = await this.getAllFilesRaw();
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
        logger.debug("Normalized trailing slash path");
      }

      fileIdx.set(normalizedPath, file);

      for (const dir of collectParentDirectories(normalizedPath)) {
        dirIdx.add(dir);
      }
    }

    this.fileIndex = fileIdx;
    this.directoryIndex = dirIdx;
    this.pathMapping = pathMap;

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
  }

  clearIndex(): void {
    this.fileIndex = null;
    this.directoryIndex = null;
    this.pathMapping.clear();
  }

  getOriginalApiPath(normalizedPath: string): string {
    return this.pathMapping.get(normalizedPath) ?? normalizedPath;
  }

  private async getAllFilesRaw(): Promise<ProjectFile[]> {
    return await loadAllProjectFiles({
      client: this.client,
      cache: this.cache,
      contextProvider: this.contextProvider,
      logger,
      operationLabel: "stat",
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
    knownExtensionFallback: "exact" | "wildcard" = "exact",
  ): Promise<string | null | undefined> {
    if (isFrameworkSourcePath(normalizedPath)) {
      logger.debug("Skipping API search for framework path");
      return null;
    }

    if (!this.apiSearchCircuitBreaker.canSearch()) {
      logger.warn("API search circuit breaker open, skipping");
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
        const matches = await this.client.searchFiles(pattern);
        sawSuccessfulSearch = true;
        this.apiSearchCircuitBreaker.recordSuccess();

        const normalizedMatches = this.normalizeMatchedPaths(matches);
        if (pattern === normalizedPath) {
          const exactMatch = normalizedMatches.find((match) => match.path === normalizedPath);
          if (exactMatch) {
            logger.debug("resolveFile found exact file via API search");
            return exactMatch.path;
          }
          continue;
        }

        const sortedMatches = sortPathsByExtensionPriority(normalizedMatches, EXTENSION_PRIORITY);
        const first = sortedMatches[0];
        if (first) {
          logger.debug("resolveFile found via API search");
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
        logger.error("API pattern search failed", {
          errorClass: classifyFilesystemError(error),
        });
      }

      if (!this.apiSearchCircuitBreaker.canSearch()) {
        logger.warn("API search circuit breaker open, aborting remaining patterns");
        return undefined;
      }
    }

    if (sawSuccessfulSearch) {
      logger.debug("resolveFile not found via API search", {
        patternCount: patterns.length,
      });
      return null;
    }

    return undefined;
  }

  private async hasCachedFileList(): Promise<boolean> {
    if (this.contextProvider?.hasCachedFileList) {
      return await this.contextProvider.hasCachedFileList();
    }

    const files = await this.contextProvider?.getFileList?.();
    return Array.isArray(files) && files.length > 0;
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
        indexMs,
        totalMs,
      });
      return indexPath;
    }

    return null;
  }

  async exists(path: string): Promise<boolean> {
    return withFilesystemSpan(
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
    );
  }

  async resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    const resolveStart = performance.now();
    const normalizedPath = this.normalizer.normalize(basePath);
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = `${buildStatCacheKeyPrefix(ctx)}:resolve:${normalizedPath}`;

    logger.debug("resolveFile called");

    const cached = await this.cache.getAsync<string>(cacheKey);
    if (cached === NOT_FOUND_SENTINEL) {
      logger.debug("resolveFile cached negative result");
      return null;
    }

    if (cached !== undefined) {
      logger.debug("resolveFile cache hit");
      return cached;
    }

    const hasCachedFileList = await this.hasCachedFileList();
    const attemptedApiResolve = !hasCachedFileList;

    if (!hasCachedFileList) {
      const apiResolved = await this.tryResolveViaApiSearch(normalizedPath, options);
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
    await this.ensureIndexBuilt();
    const indexMs = Math.round(performance.now() - indexStart);

    const fileIdx = this.fileIndex;
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

    if (attemptedApiResolve) {
      logger.debug("resolveFile not found after pre-index API search", {
        indexMs,
      });
      this.cache.set(cacheKey, NOT_FOUND_SENTINEL);
      return null;
    }

    if (isFrameworkSourcePath(normalizedPath)) {
      logger.debug("Skipping API search for framework path");
      return null;
    }

    // NOTE: Keep the post-index API fallback aligned with the pre-index helper for extensionless
    // paths, while preserving the older wildcard sibling-extension lookup for known-extension
    // paths. Incomplete file-list snapshots otherwise hide valid files until the cache refreshes.
    const apiResolved = await this.tryResolveViaApiSearch(normalizedPath, options, "wildcard");
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
