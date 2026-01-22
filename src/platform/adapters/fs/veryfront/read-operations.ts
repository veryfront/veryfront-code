import { logger } from "#veryfront/utils";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import type { ResolvedContentContext } from "./types.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";

export interface ContentContextProvider {
  isProductionMode: () => boolean;
  getReleaseId: () => string | null;
  getContentContext: () => ResolvedContentContext | null;
}

/**
 * Extension priority for file resolution.
 * Used when searching for files without a known extension.
 */
const EXTENSION_PRIORITY = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"] as const;

export class ReadOperations {
  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
    private readonly contextProvider?: ContentContextProvider,
    // Resolver for normalized paths -> original API paths (e.g., "pages/index.mdx" -> "pages/")
    private readonly getOriginalApiPath?: (path: string) => string,
    // Getter for cached file list (to check for pre-fetched content)
    // Now async to support Redis cache lookup across pods
    private readonly getFileListCache?: () => Promise<
      Array<{ path: string; content?: string }> | undefined
    >,
  ) {}

  /**
   * Check if content is available in the cached file list.
   * This avoids redundant API calls when the file list already includes content.
   * Now async to support Redis cache lookup across pods.
   */
  private async getContentFromFileList(normalizedPath: string): Promise<string | undefined> {
    const fileList = await this.getFileListCache?.();
    if (!fileList) {
      logger.debug("[ReadOperations] No file list cache available");
      return undefined;
    }

    const file = fileList.find((f) => f.path === normalizedPath);
    if (file?.content) {
      logger.debug("[ReadOperations] Found content in file list cache", {
        path: normalizedPath,
        contentLength: file.content.length,
      });
      return file.content;
    }
    logger.debug("[ReadOperations] Content not in file list cache", {
      path: normalizedPath,
      fileFound: !!file,
      hasContent: !!file?.content,
      fileListSize: fileList.length,
    });
    return undefined;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const normalizedPath = this.normalizer.normalize(path);
    const content = await this.fetchContent(normalizedPath);
    return new TextEncoder().encode(content);
  }

  readTextFile(path: string): Promise<string> {
    const normalizedPath = this.normalizer.normalize(path);
    logger.debug("[ReadOperations] readTextFile called", { path, normalizedPath });
    return this.fetchContent(normalizedPath);
  }

  private async fetchContent(normalizedPath: string): Promise<string> {
    const ctx = this.contextProvider?.getContentContext();
    const apiPath = this.getOriginalApiPath?.(normalizedPath) ?? normalizedPath;
    const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
    const cacheKey = `${cacheKeyPrefix}:${normalizedPath}`;

    // Skip file content caching in dev/preview mode (non-production) for fresh content
    const isProduction = this.contextProvider?.isProductionMode() ?? false;

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

    // Check cache first (memory + Redis) - only in production
    if (isProduction) {
      const cached = await this.cache.getAsync<string>(cacheKey);
      if (cached) {
        logger.debug("[ReadOperations] Cache hit", { path: normalizedPath, cacheKey });
        return cached;
      }
    }

    // Check if content is available in the file list cache (memory + Redis)
    // Skip in non-production mode to ensure fresh content
    if (isProduction) {
      const fileListContent = await this.getContentFromFileList(normalizedPath);
      if (fileListContent) {
        this.cache.set(cacheKey, fileListContent);
        return fileListContent;
      }
    }

    // Fetch based on source type
    const isPublished = ctx?.sourceType !== "branch";

    logger.debug("[ReadOperations] fetchContent decision", {
      path: normalizedPath,
      isPublished,
      willFetch: isPublished ? "published (environment)" : "draft (branch)",
      sourceType: ctx?.sourceType ?? "null/undefined",
    });

    if (isPublished) {
      return this.fetchPublishedContent(
        normalizedPath,
        apiPath,
        cacheKey,
        ctx?.releaseId ?? null,
        isProduction,
      );
    }
    return this.fetchDraftContent(normalizedPath, apiPath, cacheKey, isProduction);
  }

  private async fetchPublishedContent(
    normalizedPath: string,
    apiPath: string,
    cacheKey: string,
    releaseId: string | null,
    shouldCache: boolean,
  ): Promise<string> {
    logger.debug("[ReadOperations] Fetching published content", {
      path: normalizedPath,
      apiPath,
      cacheKey,
    });
    try {
      const content = await this.client.getPublishedFileContent(apiPath);
      logger.debug("[ReadOperations] Fetched published content", {
        path: normalizedPath,
        contentLength: content.length,
      });
      if (shouldCache) {
        this.cache.set(cacheKey, content);
      }
      return content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const is404Error = errorMessage.includes("404") || errorMessage.includes("Not Found");

      // Try fallback extensions for 404 errors
      if (is404Error) {
        const fallbackContent = await this.tryFallbackExtensions(apiPath, cacheKey, shouldCache);
        if (fallbackContent !== null) {
          return fallbackContent;
        }

        logger.debug("[ReadOperations] File not found (expected for optional files)", {
          path: normalizedPath,
          apiPath,
        });
      } else {
        logger.error("[ReadOperations] Failed to fetch published content", {
          path: normalizedPath,
          apiPath,
          releaseId,
          error: errorMessage,
        });
      }
      throw error;
    }
  }

  /**
   * Try fetching file content with alternative extensions using pattern search.
   * Uses a single API call with pattern matching instead of sequential requests.
   * This optimizes the 404 fallback from 6 sequential HTTP calls to 1.
   */
  private async tryFallbackExtensions(
    apiPath: string,
    cacheKey: string,
    shouldCache: boolean,
  ): Promise<string | null> {
    const extMatch = apiPath.match(/\.(tsx|ts|jsx|js|mdx|md)$/);
    if (!extMatch) {
      return null;
    }

    const originalExt = extMatch[0];
    const basePath = apiPath.slice(0, -originalExt.length);

    logger.debug("[ReadOperations] Searching for file with pattern", {
      originalPath: apiPath,
      pattern: `${basePath}.*`,
    });

    try {
      // Use pattern search to find all matching files in ONE API call
      const result = await this.client.resolveFileWithExtension(
        basePath,
        EXTENSION_PRIORITY as unknown as string[],
      );

      if (result) {
        logger.debug("[ReadOperations] Pattern search found file", {
          originalPath: apiPath,
          foundPath: result.path,
          contentLength: result.content.length,
        });

        if (shouldCache) {
          this.cache.set(cacheKey, result.content);
        }
        return result.content;
      }
    } catch (error) {
      logger.debug("[ReadOperations] Pattern search failed, trying sequential fallback", {
        originalPath: apiPath,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to sequential approach if pattern search fails
      // (e.g., if the API doesn't support the pattern endpoint)
      return this.tryFallbackExtensionsSequential(
        apiPath,
        originalExt,
        basePath,
        cacheKey,
        shouldCache,
      );
    }

    return null;
  }

  /**
   * Sequential fallback for extension resolution.
   * Used as backup if pattern search is unavailable.
   * @deprecated Prefer pattern-based resolution via tryFallbackExtensions
   */
  private async tryFallbackExtensionsSequential(
    apiPath: string,
    originalExt: string,
    basePath: string,
    cacheKey: string,
    shouldCache: boolean,
  ): Promise<string | null> {
    for (const ext of EXTENSION_PRIORITY) {
      if (ext === originalExt) continue;

      const fallbackPath = basePath + ext;
      try {
        const content = await this.client.getPublishedFileContent(fallbackPath);

        logger.debug("[ReadOperations] Sequential fallback succeeded", {
          originalPath: apiPath,
          fallbackPath,
          contentLength: content.length,
        });

        if (shouldCache) {
          this.cache.set(cacheKey, content);
        }
        return content;
      } catch {
        // Continue to next extension
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
    logger.debug("[ReadOperations] Fetching draft content", {
      path: normalizedPath,
      apiPath,
      cacheKey,
    });
    const content = await this.client.getFileContent(apiPath);
    if (shouldCache) {
      this.cache.set(cacheKey, content);
    }
    return content;
  }
}
