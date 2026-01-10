import { logger } from "@veryfront/utils";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";

export interface ProductionModeContext {
  isProductionMode: () => boolean;
  getReleaseId: () => string | null;
}

/**
 * Alternative extensions to try when a file fetch fails with 404.
 * This handles API inconsistencies where the file listing returns a different
 * extension than what the entity slug uses (e.g., file renamed from .tsx to .mdx
 * but entity slug still uses old extension).
 */
const FALLBACK_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

export class ReadOperations {
  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
    private readonly productionContext?: ProductionModeContext,
    // Resolver for normalized paths -> original API paths (e.g., "pages/index.mdx" -> "pages/")
    private readonly getOriginalApiPath?: (path: string) => string,
  ) {}

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

  private fetchContent(normalizedPath: string): Promise<string> {
    const isProduction = this.productionContext?.isProductionMode() ?? false;
    const releaseId = this.productionContext?.getReleaseId() ?? null;
    // Get the original API path for fetching (handles normalized paths like "pages/index.mdx" -> "pages/")
    const apiPath = this.getOriginalApiPath?.(normalizedPath) ?? normalizedPath;

    if (isProduction) {
      return this.fetchPublishedContent(normalizedPath, apiPath, releaseId);
    }
    return this.fetchDraftContent(normalizedPath, apiPath);
  }

  private async fetchPublishedContent(
    normalizedPath: string,
    apiPath: string,
    releaseId: string | null,
  ): Promise<string> {
    const cacheKey = `file:published:${releaseId ?? "latest"}:${normalizedPath}`;

    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      logger.debug("[ReadOperations] Cache hit (published)", { path: normalizedPath, releaseId });
      return cached;
    }

    logger.debug("[ReadOperations] Fetching published content", {
      path: normalizedPath,
      apiPath,
      releaseId: releaseId ?? "latest",
    });
    try {
      // Use apiPath for the actual API call (handles normalized paths like "pages/index.mdx" -> "pages/")
      const content = await this.client.getPublishedFileContent(
        apiPath,
        undefined,
        releaseId ?? undefined,
      );
      logger.debug("[ReadOperations] Fetched published content", {
        path: normalizedPath,
        contentLength: content.length,
      });
      // Published content is immutable, cache for long time
      this.cache.set(cacheKey, content);
      return content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const is404Error = errorMessage.includes("404") || errorMessage.includes("Not Found");

      // Try fallback extensions for 404 errors
      // This handles API inconsistencies where file listing uses different extension
      // than the entity slug (e.g., file renamed from .tsx to .mdx)
      if (is404Error) {
        const fallbackContent = await this.tryFallbackExtensions(apiPath, releaseId, cacheKey);
        if (fallbackContent !== null) {
          return fallbackContent;
        }

        logger.debug("[ReadOperations] File not found (expected for optional files)", {
          path: normalizedPath,
          apiPath,
          releaseId,
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
   * Try fetching file content with alternative extensions.
   * This is a workaround for API data inconsistencies where the file listing
   * returns a different extension than what the entity slug uses.
   */
  private async tryFallbackExtensions(
    apiPath: string,
    releaseId: string | null,
    cacheKey: string,
  ): Promise<string | null> {
    // Extract the base path without extension
    const extMatch = apiPath.match(/\.(tsx|ts|jsx|js|mdx|md)$/);
    if (!extMatch) {
      return null;
    }

    const originalExt = extMatch[0];
    const basePath = apiPath.slice(0, -originalExt.length);

    // Try each fallback extension (skip the original)
    for (const ext of FALLBACK_EXTENSIONS) {
      if (ext === originalExt) continue;

      const fallbackPath = basePath + ext;
      try {
        logger.debug("[ReadOperations] Trying fallback extension", {
          originalPath: apiPath,
          fallbackPath,
          releaseId,
        });

        const content = await this.client.getPublishedFileContent(
          fallbackPath,
          undefined,
          releaseId ?? undefined,
        );

        logger.info("[ReadOperations] Fallback extension succeeded", {
          originalPath: apiPath,
          fallbackPath,
          releaseId,
          contentLength: content.length,
        });

        // Cache with original key so subsequent requests don't need fallback
        this.cache.set(cacheKey, content);
        return content;
      } catch {
        // Continue to next extension
      }
    }

    return null;
  }

  private async fetchDraftContent(normalizedPath: string, apiPath: string): Promise<string> {
    const branch = this.client.getRequestBranch() || "main";
    const cacheKey = `file:text:${branch}:${normalizedPath}`;

    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      logger.debug("[ReadOperations] Cache hit (draft)", { path: normalizedPath });
      return cached;
    }

    logger.debug("[ReadOperations] Fetching draft content", { path: normalizedPath, apiPath });
    // Use apiPath for the actual API call (handles normalized paths like "pages/index.mdx" -> "pages/")
    const content = await this.client.getFileContent(apiPath);
    this.cache.set(cacheKey, content);
    return content;
  }
}
