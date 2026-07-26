import { logger as baseLogger } from "#veryfront/utils";
import { isFrameworkSourcePath } from "#veryfront/utils/path-utils.ts";
import type { FileInfo, ResolveFileOptions } from "../../base.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { VeryfrontOperationsBase } from "./base-operations.ts";
import { createError, fromError, toError, VeryfrontError } from "#veryfront/errors";
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

const logger = baseLogger.component("stat-operations");

const NOT_FOUND_SENTINEL = "__NOT_FOUND__";

const API_SEARCH_CIRCUIT_BREAKER_THRESHOLD = 5;
const API_SEARCH_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof VeryfrontError && error.slug === "file-not-found") {
    return true;
  }

  const veryfrontError = fromError(error);
  return veryfrontError?.type === "file" && veryfrontError.message.startsWith("File not found:");
}

interface SearchFileMatch {
  id?: string;
  path: string;
}

function toFileInfo(file: Pick<ProjectFile, "path" | "size" | "updated_at">): FileInfo {
  if (!Number.isFinite(file.size) || file.size < 0) {
    throw new TypeError(`Malformed file metadata for "${file.path}": size must be non-negative`);
  }

  const mtime = new Date(file.updated_at);
  if (Number.isNaN(mtime.getTime())) {
    throw new TypeError(`Malformed file metadata for "${file.path}": updated_at is invalid`);
  }

  return {
    size: file.size,
    mtime,
    isDirectory: false,
    isFile: true,
    isSymlink: false,
  };
}

function assertValidSearchMatches(matches: unknown): asserts matches is SearchFileMatch[] {
  const valid = Array.isArray(matches) &&
    matches.every((match) => {
      if (typeof match !== "object" || match === null) return false;
      const { id, path } = match as { id?: unknown; path?: unknown };
      return typeof path === "string" && (id === undefined || typeof id === "string");
    });

  if (!valid) {
    throw new TypeError(
      "Malformed searchFiles response: expected an array of { path: string, id?: string } matches",
    );
  }
}

export class StatOperations extends VeryfrontOperationsBase {
  private fileIndex: Map<string, ProjectFile> | null = null;
  private directoryIndex: Set<string> | null = null;
  private buildingIndex: Promise<void> | null = null;
  private indexGeneration = 0;

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

    await this.ensureIndexBuilt();

    const fileIdx = this.fileIndex;
    const dirIdx = this.directoryIndex;

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
      return toFileInfo(file);
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
    // Skip for framework paths (node_modules, _veryfront, etc.)
    if (!isFrameworkSourcePath(normalizedPath) && this.apiSearchCircuitBreaker.canSearch()) {
      const hasKnownExt = EXTENSION_PRIORITY.some((ext) => normalizedPath.endsWith(ext));
      if (hasKnownExt) {
        logger.debug("stat file not in index, trying API search", {
          normalizedPath,
          indexSize: fileIdx.size,
        });

        try {
          // Search for the exact file path
          const matches = await this.client.searchFiles(normalizedPath);
          assertValidSearchMatches(matches);
          this.apiSearchCircuitBreaker.recordSuccess();

          const exactMatch = matches.find((m) => m.path === normalizedPath);
          if (exactMatch) {
            const detail = await this.client.getFile(exactMatch.path);
            const detailPath = this.normalizer.normalize(detail.path);
            if (detailPath !== normalizedPath) {
              throw new TypeError(
                `Malformed file detail response: expected "${normalizedPath}", received "${detailPath}"`,
              );
            }

            const indexedDetail: ProjectFile = {
              id: detail.id ?? exactMatch.id,
              version_id: detail.version_id,
              path: detailPath,
              content: detail.content,
              type: detail.type,
              size: detail.size,
              updated_at: detail.updated_at,
            };
            const info = toFileInfo(indexedDetail);
            logger.debug("stat found via API search", { normalizedPath });
            fileIdx.set(normalizedPath, indexedDetail);
            return info;
          }
        } catch (error) {
          if (isFileNotFoundError(error)) {
            this.apiSearchCircuitBreaker.recordSuccess();
            logger.debug("stat API search returned no matching file", {
              normalizedPath,
            });
          } else {
            const result = this.apiSearchCircuitBreaker.recordFailure();
            if (result.tripped) {
              logger.warn("stat API search circuit breaker tripped", {
                failures: result.failures,
              });
            }
            logger.error("stat API search failed", {
              normalizedPath,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
      }
    }

    logger.debug("stat file not found (not in index)", {
      normalizedPath,
      indexSize: fileIdx.size,
    });
    throw toError(
      createError({
        type: "file",
        message: `File not found: ${normalizedPath}`,
      }),
    );
  }

  private async ensureIndexBuilt(): Promise<void> {
    while (!this.fileIndex || !this.directoryIndex) {
      const generation = this.indexGeneration;
      let build = this.buildingIndex;
      if (!build) {
        build = this.buildIndex(generation);
        this.buildingIndex = build;
      } else {
        logger.debug("ensureIndexBuilt - waiting for concurrent build");
      }

      try {
        await build;
      } finally {
        if (this.buildingIndex === build) this.buildingIndex = null;
      }
    }
  }

  private async buildIndex(generation: number): Promise<void> {
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

    if (this.indexGeneration !== generation) {
      logger.debug("Discarded file index built for an invalidated snapshot", {
        generation,
        currentGeneration: this.indexGeneration,
      });
      return;
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
    this.indexGeneration++;
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
        const matches = await this.client.searchFiles(pattern);
        assertValidSearchMatches(matches);
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
        if (isFileNotFoundError(error)) {
          sawSuccessfulSearch = true;
          this.apiSearchCircuitBreaker.recordSuccess();
          continue;
        }

        const result = this.apiSearchCircuitBreaker.recordFailure();
        if (result.tripped) {
          logger.warn("API search circuit breaker tripped", {
            failures: result.failures,
          });
        }
        logger.error("API pattern search failed", { pattern, error });
        throw error;
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
