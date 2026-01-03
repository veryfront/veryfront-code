import { logger } from "@veryfront/utils";
import type { VeryfrontAPIClient } from "../veryfront-api-client.ts";
import { FileCache } from "../file-cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";

export interface ProductionModeContext {
  isProductionMode: () => boolean;
  getReleaseId: () => string | null;
}

export class ReadOperations {
  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
    private readonly productionContext?: ProductionModeContext,
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

    if (isProduction) {
      return this.fetchPublishedContent(normalizedPath, releaseId);
    }
    return this.fetchDraftContent(normalizedPath);
  }

  private async fetchPublishedContent(
    normalizedPath: string,
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
      releaseId: releaseId ?? "latest",
    });
    try {
      const content = await this.client.getPublishedFileContent(
        normalizedPath,
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
      // Use debug level for 404 errors (expected when probing for optional files like 404.tsx, _error.tsx)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const is404Error = errorMessage.includes("404") || errorMessage.includes("Not Found");
      if (is404Error) {
        logger.debug("[ReadOperations] File not found (expected for optional files)", {
          path: normalizedPath,
          releaseId,
        });
      } else {
        logger.error("[ReadOperations] Failed to fetch published content", {
          path: normalizedPath,
          releaseId,
          error: errorMessage,
        });
      }
      throw error;
    }
  }

  private async fetchDraftContent(normalizedPath: string): Promise<string> {
    const branch = this.client.getRequestBranch() || "main";
    const cacheKey = `file:text:${branch}:${normalizedPath}`;

    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      logger.debug("[ReadOperations] Cache hit (draft)", { path: normalizedPath });
      return cached;
    }

    logger.debug("[ReadOperations] Fetching draft content", { path: normalizedPath });
    const content = await this.client.getFileContent(normalizedPath);

    this.cache.set(cacheKey, content);
    return content;
  }
}
