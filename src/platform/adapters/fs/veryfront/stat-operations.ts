import { logger } from "#veryfront/utils";
import type { FileInfo } from "../../base.ts";
import type { ProjectFile, VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { createError, toError } from "#veryfront/errors";
import type { ContentContextProvider } from "./read-operations.ts";
import { buildFileListCacheKey, buildStatCacheKeyPrefix } from "./cache-keys.ts";

const EXTENSION_PRIORITY = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;

// Sentinel value for caching negative results (file not found)
const NOT_FOUND_SENTINEL = "__NOT_FOUND__";

// Framework prefixes that should not trigger API searches
// These files are resolved by import-parser.ts from FRAMEWORK_ROOT (/app/)
// Note: "lib/" is NOT included here because projects commonly have their own lib/ directories
// Framework-specific lib imports (lib/Head, lib/Router) are handled by import-parser.ts fallback
const FRAMEWORK_PREFIXES = ["exports/", "react/", "veryfront/"];

export class StatOperations {
  private fileIndex: Map<string, ProjectFile> | null = null;
  private directoryIndex: Set<string> | null = null;
  private buildingIndex: Promise<void> | null = null;
  // Map normalized paths to original API paths (for trailing slash files)
  private pathMapping: Map<string, string> = new Map();

  // Circuit breaker for API searches
  private apiSearchFailures = 0;
  private apiSearchDisabledUntil = 0;

  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
    private readonly contextProvider?: ContentContextProvider,
  ) {}

  async stat(path: string): Promise<FileInfo> {
    const normalizedPath = this.normalizer.normalize(path);
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = `${buildStatCacheKeyPrefix(ctx)}:${normalizedPath}`;

    logger.debug("[StatOperations] stat called", { path, normalizedPath, cacheKey });

    // OPTIMIZATION: Check local file index FIRST before distributed cache.
    // The local file index is an in-memory Map (nanosecond lookup) while
    // distributed cache requires HTTP calls (200-300ms).
    await this.ensureIndexBuilt();

    const fileIdx = this.fileIndex;
    const dirIdx = this.directoryIndex;

    if (!fileIdx || !dirIdx) {
      logger.debug("[StatOperations] stat - no index available", { normalizedPath });
      throw toError(createError({
        type: "file",
        message: `Index not available for: ${normalizedPath}`,
      }));
    }

    // 1. Check local file index first (fast in-memory lookup)
    const file = fileIdx.get(normalizedPath);
    if (file) {
      logger.debug("[StatOperations] stat found file", { normalizedPath });
      const info: FileInfo = {
        size: file.size,
        mtime: new Date(file.updated_at),
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      };
      return info;
    }

    // 2. Check directory index (fast in-memory lookup)
    if (dirIdx.has(normalizedPath)) {
      logger.debug("[StatOperations] stat found directory", { normalizedPath });
      const info: FileInfo = {
        size: 0,
        mtime: new Date(),
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      };
      return info;
    }

    // 3. File not in local index - it doesn't exist
    // The local file index is built from getAllFilesRaw() which fetches ALL files.
    // If a file isn't in the local index, it definitively doesn't exist.
    // No need to check distributed cache - the local index is authoritative.
    // This avoids ~100-200ms HTTP calls to distributed cache for each missing file.
    logger.debug("[StatOperations] stat file not found (not in index)", {
      normalizedPath,
      indexSize: fileIdx.size,
    });
    throw toError(createError({
      type: "file",
      message: `File not found: ${normalizedPath}`,
    }));
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

    this.buildingIndex = this.buildIndex();
    await this.buildingIndex;
    this.buildingIndex = null;
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
      // Normalize path: handle trailing slash paths like "pages/" -> "pages/index.mdx"
      let normalizedPath = file.path;
      if (file.path.endsWith("/")) {
        // Determine extension from file type - default to .mdx for pages
        const ext = file.type === "page" ? ".mdx" : ".tsx";
        normalizedPath = file.path.replace(/\/+$/, "") + "/index" + ext;
        // Store mapping from normalized path to original API path
        pathMap.set(normalizedPath, file.path);
        logger.debug("[StatOperations] Normalized trailing slash path", {
          original: file.path,
          normalized: normalizedPath,
        });
      }

      fileIdx.set(normalizedPath, file);

      const parts = normalizedPath.split("/");
      let current = "";
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part) {
          current = current ? `${current}/${part}` : part;
          dirIdx.add(current);
        }
      }
    }

    this.fileIndex = fileIdx;
    this.directoryIndex = dirIdx;
    this.pathMapping = pathMap;

    const indexMs = Math.round(performance.now() - indexStart);
    const totalMs = Math.round(performance.now() - buildStart);
    logger.info("[StatOperations] Index built", {
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

  /**
   * Get the original API path for a normalized path.
   * For paths like "pages/index.mdx" that were normalized from "pages/",
   * this returns the original "pages/" path for API content fetching.
   */
  getOriginalApiPath(normalizedPath: string): string {
    return this.pathMapping.get(normalizedPath) || normalizedPath;
  }

  private async getAllFilesRaw(): Promise<ProjectFile[]> {
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = buildFileListCacheKey(ctx);

    // Check cache first (memory + Redis)
    const cacheStart = performance.now();
    const cached = await this.cache.getAsync<ProjectFile[]>(cacheKey);
    const cacheMs = Math.round(performance.now() - cacheStart);
    if (cached) {
      logger.debug("[StatOperations] getAllFilesRaw - cache HIT", {
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

    // Fetch based on source type
    const isPublished = ctx?.sourceType !== "branch";
    logger.debug("[StatOperations] Fetching files from API", {
      sourceType: ctx?.sourceType,
      cacheKey,
    });

    let files: ProjectFile[];
    if (isPublished) {
      files = await this.client.listPublishedFiles(undefined, ctx?.releaseId ?? undefined);
    } else {
      files = await this.client.listAllFiles();
    }

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

    // OPTIMIZATION: Check local file index FIRST before distributed cache.
    // The local file index is an in-memory Map (nanosecond lookup) while
    // distributed cache requires HTTP calls (200-300ms). Only use distributed
    // cache for negative results to avoid expensive API searches.

    const indexStart = performance.now();
    await this.ensureIndexBuilt();
    const indexMs = Math.round(performance.now() - indexStart);

    const fileIdx = this.fileIndex;
    if (!fileIdx) {
      logger.debug("[StatOperations] resolveFile - no file index", { indexMs });
      return null;
    }

    // 1. Try exact match first (fast in-memory lookup)
    if (fileIdx.has(normalizedPath)) {
      const totalMs = Math.round(performance.now() - resolveStart);
      logger.debug("[StatOperations] resolveFile exact match found", {
        normalizedPath,
        indexMs,
        totalMs,
      });
      return normalizedPath;
    }

    // 2. Check if path already has an extension
    const hasExtension = EXTENSION_PRIORITY.some((ext) => normalizedPath.endsWith(ext));
    const pathWithoutExt = hasExtension
      ? normalizedPath.replace(/\.(mdx|md|tsx|jsx|ts|js)$/, "")
      : normalizedPath;

    // 3. Try each extension in priority order from local index (fast)
    for (const ext of EXTENSION_PRIORITY) {
      const pathWithExt = pathWithoutExt + ext;
      if (fileIdx.has(pathWithExt)) {
        const totalMs = Math.round(performance.now() - resolveStart);
        logger.debug("[StatOperations] resolveFile found with extension", {
          pathWithExt,
          indexMs,
          totalMs,
        });
        return pathWithExt;
      }
    }

    // 4. Try with pages/ prefix if not already present
    if (!pathWithoutExt.startsWith("pages/")) {
      const pagesPath = `pages/${pathWithoutExt}`;
      for (const ext of EXTENSION_PRIORITY) {
        const pathWithExt = pagesPath + ext;
        if (fileIdx.has(pathWithExt)) {
          const totalMs = Math.round(performance.now() - resolveStart);
          logger.debug("[StatOperations] resolveFile found with pages prefix", {
            pathWithExt,
            indexMs,
            totalMs,
          });
          return pathWithExt;
        }
      }
    }

    // 5. Try index file variants
    for (const ext of EXTENSION_PRIORITY) {
      const indexPath = `${pathWithoutExt}/index${ext}`;
      if (fileIdx.has(indexPath)) {
        const totalMs = Math.round(performance.now() - resolveStart);
        logger.debug("[StatOperations] resolveFile found index file", {
          indexPath,
          indexMs,
          totalMs,
        });
        return indexPath;
      }
    }

    // 6. Skip API search for framework paths - these are resolved by import-parser.ts
    // from FRAMEWORK_ROOT (/app/). No need to search the user's project API.
    if (FRAMEWORK_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
      logger.debug("[StatOperations] Skipping API search for framework path", { normalizedPath });
      return null;
    }

    // 7. Check circuit breaker before API search
    if (Date.now() < this.apiSearchDisabledUntil) {
      logger.warn("[StatOperations] API search circuit breaker open, skipping", { normalizedPath });
      return null;
    }

    // 8. Check distributed cache for negative results ONLY before expensive API search
    // This avoids repeated API searches for files that don't exist
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

    // If we got a positive cached result, return it (shouldn't happen often since
    // local index should have found it, but handles edge cases)
    if (cached !== undefined) {
      logger.debug("[StatOperations] resolveFile cache hit (unexpected)", {
        normalizedPath,
        cached,
        cacheCheckMs,
      });
      return cached;
    }

    // 9. If not in local index or cache, search via API pattern
    // This fallback is needed because listPublishedFiles() may not include all project files
    // (e.g., lib/, utils/, hooks/ directories). The search result is cached, so this only
    // incurs overhead on the first request for each missing file.
    const searchPattern = `${pathWithoutExt}.*`;
    logger.debug("[StatOperations] Searching for file via API", {
      pattern: searchPattern,
      normalizedPath,
      cacheCheckMs,
    });

    try {
      const matches = await this.client.searchFiles(searchPattern);
      // Reset circuit breaker on success
      this.apiSearchFailures = 0;
      logger.debug("[StatOperations] API search result", {
        pattern: searchPattern,
        matchCount: matches.length,
        matches: matches.map((m) => m.path).slice(0, 5),
      });
      if (matches.length > 0) {
        // Sort by extension priority
        const sorted = matches.sort((a, b) => {
          const extA = EXTENSION_PRIORITY.findIndex((ext) => a.path.endsWith(ext));
          const extB = EXTENSION_PRIORITY.findIndex((ext) => b.path.endsWith(ext));
          return (extA === -1 ? 99 : extA) - (extB === -1 ? 99 : extB);
        });
        const first = sorted[0];
        if (first) {
          logger.debug("[StatOperations] resolveFile found via API search", { path: first.path });
          this.cache.set(cacheKey, first.path);
          return first.path;
        }
      }
    } catch (error) {
      // Increment circuit breaker on failure
      this.apiSearchFailures++;
      if (this.apiSearchFailures >= 5) {
        this.apiSearchDisabledUntil = Date.now() + 30000; // 30s cooldown
        this.apiSearchFailures = 0;
        logger.warn("[StatOperations] API search circuit breaker tripped", { failures: 5 });
      }
      logger.error("[StatOperations] API pattern search failed", { pattern: searchPattern, error });
    }

    logger.debug("[StatOperations] resolveFile not found after API search", {
      normalizedPath,
      pathWithoutExt,
    });
    // Cache negative results to prevent repeated slow API searches
    // Files may be published later, but cache TTL (60s) handles refresh
    this.cache.set(cacheKey, NOT_FOUND_SENTINEL);
    return null;
  }
}
