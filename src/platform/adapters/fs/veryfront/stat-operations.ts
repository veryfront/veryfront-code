import { logger } from "#veryfront/utils";
import { isFrameworkSourcePath } from "#veryfront/utils/path-utils.ts";
import type { FileInfo } from "../../base.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { VeryfrontOperationsBase } from "./base-operations.ts";
import { createError, toError } from "#veryfront/errors";
import {
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "./cache-keys.ts";
import { STAT_OPERATION_EXTENSION_PRIORITY as EXTENSION_PRIORITY } from "./extension-priority.ts";
import {
  collectParentDirectories,
  normalizeIndexedFilePath,
  resolveByExtensionPriority,
  resolveIndexByExtensionPriority,
  sortPathsByExtensionPriority,
  stripKnownExtension,
} from "./stat-operations-helpers.ts";
import { APISearchCircuitBreaker } from "./api-search-circuit-breaker.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const NOT_FOUND_SENTINEL = "__NOT_FOUND__";

export class StatOperations extends VeryfrontOperationsBase {
  private fileIndex: Map<string, ProjectFile> | null = null;
  private directoryIndex: Set<string> | null = null;
  private buildingIndex: Promise<void> | null = null;

  private indexBuildLockResolver: (() => void) | null = null;
  private indexBuildLockPromise: Promise<void> | null = null;

  private pathMapping: Map<string, string> = new Map();

  private readonly apiSearchCircuitBreaker = new APISearchCircuitBreaker({
    threshold: 5,
    cooldownMs: 30000,
  });

  stat(path: string): Promise<FileInfo> {
    return withSpan(
      "fs.veryfront.stat",
      async () => {
        const normalizedPath = this.normalizer.normalize(path);
        const ctx = this.contextProvider?.getContentContext();
        const cacheKey = `${buildStatCacheKeyPrefix(ctx)}:${normalizedPath}`;

        logger.debug("[StatOperations] stat called", { path, normalizedPath, cacheKey });

        await this.ensureIndexBuilt();

        const fileIdx = this.fileIndex;
        const dirIdx = this.directoryIndex;

        if (!fileIdx || !dirIdx) {
          logger.debug("[StatOperations] stat - no index available", { normalizedPath });
          throw toError(
            createError({
              type: "file",
              message: `Index not available for: ${normalizedPath}`,
            }),
          );
        }

        const file = fileIdx.get(normalizedPath);
        if (file) {
          logger.debug("[StatOperations] stat found file", { normalizedPath });
          return {
            size: file.size,
            mtime: new Date(file.updated_at),
            isDirectory: false,
            isFile: true,
            isSymlink: false,
          };
        }

        if (dirIdx.has(normalizedPath)) {
          logger.debug("[StatOperations] stat found directory", { normalizedPath });
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
            logger.debug("[StatOperations] stat file not in index, trying API search", {
              normalizedPath,
              indexSize: fileIdx.size,
            });

            try {
              // Search for the exact file path
              const matches = await this.client.searchFiles(normalizedPath);
              this.apiSearchCircuitBreaker.recordSuccess();

              const exactMatch = matches.find((m) => m.path === normalizedPath);
              if (exactMatch) {
                logger.debug("[StatOperations] stat found via API search", { normalizedPath });
                // Add to index for future lookups
                fileIdx.set(normalizedPath, {
                  id: exactMatch.id,
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
                logger.warn("[StatOperations] stat API search circuit breaker tripped", {
                  failures: result.failures,
                });
              }
              logger.debug("[StatOperations] stat API search failed", {
                normalizedPath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        logger.debug("[StatOperations] stat file not found (not in index)", {
          normalizedPath,
          indexSize: fileIdx.size,
        });
        throw toError(
          createError({
            type: "file",
            message: `File not found: ${normalizedPath}`,
          }),
        );
      },
      { "fs.path": path },
    );
  }

  private async ensureIndexBuilt(): Promise<void> {
    if (this.fileIndex && this.directoryIndex) {
      logger.debug("[StatOperations] ensureIndexBuilt - index already built");
      return;
    }

    if (this.buildingIndex) {
      logger.debug("[StatOperations] ensureIndexBuilt - waiting for concurrent build");
      const waitStart = performance.now();
      await this.buildingIndex;
      logger.debug("[StatOperations] ensureIndexBuilt - concurrent build done", {
        waitMs: Math.round(performance.now() - waitStart),
      });
      return;
    }

    if (this.indexBuildLockPromise) {
      logger.debug("[StatOperations] ensureIndexBuilt - waiting for lock");
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
    logger.debug("[StatOperations] buildIndex START");

    const fetchStart = performance.now();
    const allFiles = await this.getAllFilesRaw();
    const fetchMs = Math.round(performance.now() - fetchStart);
    logger.debug("[StatOperations] buildIndex - getAllFilesRaw done", {
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
        logger.debug("[StatOperations] Normalized trailing slash path", {
          original: originalPath,
          normalized: normalizedPath,
        });
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
    logger.debug("[StatOperations] Index built", {
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
    const cacheStart = performance.now();
    const ctx = this.contextProvider?.getContentContext();
    const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
    const skipPersistentCache =
      this.contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ?? false;

    if (!skipPersistentCache) {
      const files = await this.contextProvider?.getFileList?.();
      if (files) {
        const cacheMs = Math.round(performance.now() - cacheStart);
        logger.debug("[StatOperations] getAllFilesRaw - from adapter cache", {
          cacheMs,
          fileCount: files.length,
        });
        return files as ProjectFile[];
      }
    }

    const cacheKey = buildFileListCacheKey(ctx);

    if (skipPersistentCache) {
      logger.debug("[StatOperations] getAllFilesRaw - skipping persistent cache (invalidation)", {
        cacheKey,
        cacheKeyPrefix,
      });
    }

    const cached = skipPersistentCache
      ? undefined
      : await this.cache.getAsync<ProjectFile[]>(cacheKey);
    const cacheMs = Math.round(performance.now() - cacheStart);

    if (cached) {
      logger.debug("[StatOperations] getAllFilesRaw - fallback cache HIT", {
        cacheKey,
        cacheMs,
        fileCount: cached.length,
      });
      return cached;
    }

    logger.warn("[StatOperations] getAllFilesRaw - cache MISS, fetching from API", {
      cacheKey,
      cacheMs,
    });

    const isPublished = ctx?.sourceType !== "branch";
    logger.debug("[StatOperations] Fetching files from API", {
      sourceType: ctx?.sourceType,
      cacheKey,
    });

    const files = isPublished
      ? await this.client.listPublishedFiles(
        undefined,
        ctx?.releaseId ?? undefined,
        ctx?.environmentName ?? undefined,
      )
      : await this.client.listAllFiles();

    this.cache.set(cacheKey, files);
    return files;
  }

  async exists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizer.normalize(path);
    try {
      await this.stat(normalizedPath);
      return true;
    } catch {
      return false;
    }
  }

  async resolveFile(basePath: string): Promise<string | null> {
    const resolveStart = performance.now();
    const normalizedPath = this.normalizer.normalize(basePath);
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = `${buildStatCacheKeyPrefix(ctx)}:resolve:${normalizedPath}`;

    logger.debug("[StatOperations] resolveFile called", {
      basePath,
      normalizedPath,
      cacheKey,
    });

    const indexStart = performance.now();
    await this.ensureIndexBuilt();
    const indexMs = Math.round(performance.now() - indexStart);

    const fileIdx = this.fileIndex;
    if (!fileIdx) {
      logger.debug("[StatOperations] resolveFile - no file index", { indexMs });
      return null;
    }

    if (fileIdx.has(normalizedPath)) {
      const totalMs = Math.round(performance.now() - resolveStart);
      logger.debug("[StatOperations] resolveFile exact match found", {
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
      logger.debug("[StatOperations] resolveFile found with extension", {
        pathWithExt: resolvedDirect,
        indexMs,
        totalMs,
      });
      return resolvedDirect;
    }

    if (!pathWithoutExt.startsWith("pages/")) {
      const resolvedPages = resolveByExtensionPriority(
        fileIdx,
        `pages/${pathWithoutExt}`,
        EXTENSION_PRIORITY,
      );
      if (resolvedPages) {
        const totalMs = Math.round(performance.now() - resolveStart);
        logger.debug("[StatOperations] resolveFile found with pages prefix", {
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
      logger.debug("[StatOperations] resolveFile found index file", {
        indexPath,
        indexMs,
        totalMs,
      });
      return indexPath;
    }

    if (isFrameworkSourcePath(normalizedPath)) {
      logger.debug("[StatOperations] Skipping API search for framework path", { normalizedPath });
      return null;
    }

    // NOTE: Removed optimization that skipped API search for paths with extensions.
    // This was causing layout files and other project files to not be found when
    // they were missing from the file index (due to cache issues, incomplete fetch, etc.).
    // The API pattern search is the fallback to ensure files can still be found.

    if (!this.apiSearchCircuitBreaker.canSearch()) {
      logger.warn("[StatOperations] API search circuit breaker open, skipping", { normalizedPath });
      return null;
    }

    const cacheCheckStart = performance.now();
    const cached = await this.cache.getAsync<string>(cacheKey);
    const cacheCheckMs = Math.round(performance.now() - cacheCheckStart);

    if (cached === NOT_FOUND_SENTINEL) {
      logger.debug("[StatOperations] resolveFile cached negative result", {
        normalizedPath,
        cacheCheckMs,
      });
      return null;
    }

    if (cached !== undefined) {
      logger.debug("[StatOperations] resolveFile cache hit (unexpected)", {
        normalizedPath,
        cached,
        cacheCheckMs,
      });
      return cached;
    }

    const searchPattern = `${pathWithoutExt}.*`;
    logger.debug("[StatOperations] Searching for file via API", {
      pattern: searchPattern,
      normalizedPath,
      cacheCheckMs,
    });

    try {
      const matches = await this.client.searchFiles(searchPattern);
      this.apiSearchCircuitBreaker.recordSuccess();

      logger.debug("[StatOperations] API search result", {
        pattern: searchPattern,
        matchCount: matches.length,
        matches: matches.map((m) => m.path).slice(0, 5),
      });

      const sortedMatches = sortPathsByExtensionPriority(matches, EXTENSION_PRIORITY);
      const first = sortedMatches[0];
      if (first) {
        logger.debug("[StatOperations] resolveFile found via API search", { path: first.path });
        this.cache.set(cacheKey, first.path);
        return first.path;
      }
    } catch (error) {
      const result = this.apiSearchCircuitBreaker.recordFailure();
      if (result.tripped) {
        logger.warn("[StatOperations] API search circuit breaker tripped", {
          failures: result.failures,
        });
      }
      logger.error("[StatOperations] API pattern search failed", { pattern: searchPattern, error });
    }

    logger.debug("[StatOperations] resolveFile not found after API search", {
      normalizedPath,
      pathWithoutExt,
    });

    this.cache.set(cacheKey, NOT_FOUND_SENTINEL);
    return null;
  }
}
