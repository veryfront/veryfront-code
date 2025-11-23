import { logger } from "@veryfront/utils";
import type { VeryfrontAPIClient } from "../veryfront-api-client.ts";
import { FileCache } from "../file-cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";

export class ReadOperations {
  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
  ) {}

  async readFile(path: string): Promise<Uint8Array> {
    const normalizedPath = this.normalizer.normalize(path);
    const cacheKey = `file:content:${normalizedPath}`;

    const cached = this.cache.get<Uint8Array>(cacheKey);
    if (cached) {
      logger.debug("[ReadOperations] Cache hit (readFile)", { path: normalizedPath });
      return cached;
    }

    logger.debug("[ReadOperations] Fetching file content", { path: normalizedPath });
    const content = await this.client.getFileContent(normalizedPath);
    const bytes = new TextEncoder().encode(content);

    this.cache.set(cacheKey, bytes);
    return bytes;
  }

  async readTextFile(path: string): Promise<string> {
    const normalizedPath = this.normalizer.normalize(path);
    const cacheKey = `file:text:${normalizedPath}`;

    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      logger.debug("[ReadOperations] Cache hit (readTextFile)", { path: normalizedPath });
      return cached;
    }

    logger.debug("[ReadOperations] Fetching file content", { path: normalizedPath });
    const content = await this.client.getFileContent(normalizedPath);

    this.cache.set(cacheKey, content);
    return content;
  }
}
