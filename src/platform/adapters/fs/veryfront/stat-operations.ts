import { logger } from "@veryfront/utils";
import type { FileInfo } from "../../base.ts";
import type { ProjectFile, VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { createError, toError } from "../../../../core/errors/veryfront-error.ts";
import type { ContentContextProvider } from "./read-operations.ts";
import { buildFileListCacheKey, buildStatCacheKeyPrefix } from "./cache-keys.ts";

const EXTENSION_PRIORITY = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;

export class StatOperations {
  private fileIndex: Map<string, ProjectFile> | null = null;
  private directoryIndex: Set<string> | null = null;
  private buildingIndex: Promise<void> | null = null;
  // Map normalized paths to original API paths (for trailing slash files)
  private pathMapping: Map<string, string> = new Map();

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

    const cached = this.cache.get<FileInfo>(cacheKey);
    if (cached) {
      logger.debug("[StatOperations] stat cache hit", { normalizedPath });
      return cached;
    }

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

    const file = fileIdx.get(normalizedPath);
    if (file) {
      logger.debug("[StatOperations] stat found file", { normalizedPath });
      const info: FileInfo = {
        size: file.size,
        mtime: file.updated_at ? new Date(file.updated_at) : new Date(),
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      };
      this.cache.set(cacheKey, info);
      return info;
    }

    if (dirIdx.has(normalizedPath)) {
      logger.debug("[StatOperations] stat found directory", { normalizedPath });
      const info: FileInfo = {
        size: 0,
        mtime: new Date(),
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      };
      this.cache.set(cacheKey, info);
      return info;
    }

    // Log at info level for debugging production issues
    // Include sample of available files to diagnose path mismatches
    const availableFiles = Array.from(fileIdx.keys()).slice(0, 20);
    const hasComponentsDir = availableFiles.some((f) => f.startsWith("components/"));
    const isPublished = ctx?.sourceType !== "branch";
    logger.info("[StatOperations] stat file not found", {
      path,
      normalizedPath,
      isPublished,
      indexSize: fileIdx.size,
      hasComponentsDir,
      sampleFiles: availableFiles,
    });
    throw toError(createError({
      type: "file",
      message: `File not found: ${normalizedPath}`,
    }));
  }

  private async ensureIndexBuilt(): Promise<void> {
    if (this.fileIndex && this.directoryIndex) return;

    if (this.buildingIndex) {
      await this.buildingIndex;
      return;
    }

    this.buildingIndex = this.buildIndex();
    await this.buildingIndex;
    this.buildingIndex = null;
  }

  private async buildIndex(): Promise<void> {
    const allFiles = await this.getAllFilesRaw();
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

    logger.info("[StatOperations] Index built", {
      files: fileIdx.size,
      directories: dirIdx.size,
      pathMappings: pathMap.size,
      filePaths: Array.from(fileIdx.keys()),
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

    const cached = this.cache.get<ProjectFile[]>(cacheKey);
    if (cached) {
      return cached;
    }

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
    const normalizedPath = this.normalizer.normalize(basePath);
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = `${buildStatCacheKeyPrefix(ctx)}:resolve:${normalizedPath}`;

    logger.debug("[StatOperations] resolveFile called", {
      basePath,
      normalizedPath,
      cacheKey,
    });

    const cached = this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) {
      logger.debug("[StatOperations] resolveFile cache hit", { normalizedPath, cached });
      return cached;
    }

    await this.ensureIndexBuilt();

    const fileIdx = this.fileIndex;
    if (!fileIdx) {
      logger.debug("[StatOperations] resolveFile - no file index");
      return null;
    }

    logger.debug("[StatOperations] resolveFile index lookup", {
      normalizedPath,
      fileCount: fileIdx.size,
    });

    // 1. Try exact match first
    if (fileIdx.has(normalizedPath)) {
      logger.debug("[StatOperations] resolveFile exact match found", { normalizedPath });
      this.cache.set(cacheKey, normalizedPath);
      return normalizedPath;
    }

    // 2. Check if path already has an extension
    const hasExtension = EXTENSION_PRIORITY.some((ext) => normalizedPath.endsWith(ext));
    const pathWithoutExt = hasExtension
      ? normalizedPath.replace(/\.(mdx|md|tsx|jsx|ts|js)$/, "")
      : normalizedPath;

    logger.debug("[StatOperations] resolveFile trying extensions", {
      pathWithoutExt,
      hasExtension,
    });

    // 3. Try each extension in priority order from cached index
    for (const ext of EXTENSION_PRIORITY) {
      const pathWithExt = pathWithoutExt + ext;
      if (fileIdx.has(pathWithExt)) {
        logger.debug("[StatOperations] resolveFile found with extension", { pathWithExt });
        this.cache.set(cacheKey, pathWithExt);
        return pathWithExt;
      }
    }

    // 4. Try with pages/ prefix if not already present
    if (!pathWithoutExt.startsWith("pages/")) {
      const pagesPath = `pages/${pathWithoutExt}`;
      for (const ext of EXTENSION_PRIORITY) {
        const pathWithExt = pagesPath + ext;
        if (fileIdx.has(pathWithExt)) {
          logger.debug("[StatOperations] resolveFile found with pages prefix", { pathWithExt });
          this.cache.set(cacheKey, pathWithExt);
          return pathWithExt;
        }
      }
    }

    // 5. Try index file variants
    for (const ext of EXTENSION_PRIORITY) {
      const indexPath = `${pathWithoutExt}/index${ext}`;
      if (fileIdx.has(indexPath)) {
        logger.debug("[StatOperations] resolveFile found index file", { indexPath });
        this.cache.set(cacheKey, indexPath);
        return indexPath;
      }
    }

    // 6. If not in cache, search via API pattern (only in development mode)
    // In production mode, we only have published files, so skip the search
    const isPublished = ctx?.sourceType !== "branch";
    if (!isPublished) {
      const searchPattern = `${pathWithoutExt}.*`;
      logger.debug("[StatOperations] Searching for file pattern (dev mode)", {
        pattern: searchPattern,
      });

      try {
        const matches = await this.client.searchFiles(searchPattern);
        if (matches.length > 0) {
          // Sort by extension priority
          const sorted = matches.sort((a, b) => {
            const extA = EXTENSION_PRIORITY.findIndex((ext) => a.path.endsWith(ext));
            const extB = EXTENSION_PRIORITY.findIndex((ext) => b.path.endsWith(ext));
            return (extA === -1 ? 99 : extA) - (extB === -1 ? 99 : extB);
          });
          const first = sorted[0];
          if (first) {
            logger.debug("[StatOperations] resolveFile found via search", { path: first.path });
            this.cache.set(cacheKey, first.path);
            return first.path;
          }
        }
      } catch (error) {
        logger.debug("[StatOperations] Pattern search failed", { pattern: searchPattern, error });
      }
    }

    logger.debug("[StatOperations] resolveFile not found", { normalizedPath, pathWithoutExt });
    // Don't cache null/not-found results - files may be published later
    return null;
  }
}
