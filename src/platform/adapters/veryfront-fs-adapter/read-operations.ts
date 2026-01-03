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
    const content = await this.client.getPublishedFileContent(
      normalizedPath,
      undefined,
      releaseId ?? undefined,
    );

    // Published content is immutable, cache for long time
    this.cache.set(cacheKey, content);
    return content;
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
