import { buildGitHubBytesCacheKey, buildGitHubContentCacheKey } from "#veryfront/cache";
import { FILE_NOT_FOUND, INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import type { FileCache } from "../cache/file-cache.ts";
import type { GitHubApiClient } from "./github-api-client.ts";
import type { GitHubStatOperations } from "./stat-operations.ts";
import type { GitHubContentItem, ResolvedGitHubConfig } from "./types.ts";
import { normalizeGitHubPath } from "./path-utils.ts";

const LOG_PREFIX = "[GitHubReadOperations]";

/** Max file size for Contents API (1MB) */
const MAX_CONTENTS_SIZE = 1024 * 1024;

export class GitHubReadOperations {
  private readonly config: ResolvedGitHubConfig;
  private readonly client: GitHubApiClient;
  private readonly cache: FileCache;
  private readonly statOps: GitHubStatOperations;
  private readonly projectDir: string;
  private generation = 0;

  constructor(
    config: ResolvedGitHubConfig,
    client: GitHubApiClient,
    cache: FileCache,
    statOps: GitHubStatOperations,
    projectDir: string = "",
  ) {
    this.config = config;
    this.client = client;
    this.cache = cache;
    this.statOps = statOps;
    this.projectDir = projectDir;
  }

  async readTextFile(path: string): Promise<string> {
    const generation = this.generation;
    const normalizedPath = normalizeGitHubPath(path, this.projectDir);
    const cacheKey = buildGitHubContentCacheKey(this.config.ref, normalizedPath);
    const cached = this.cache.get<string>(cacheKey);
    if (cached !== undefined) return cached;

    logger.debug(`${LOG_PREFIX} Reading text file`);

    const fileEntry = this.statOps.getFileEntry(normalizedPath);
    const content = fileEntry?.size && fileEntry.size > MAX_CONTENTS_SIZE
      ? await this.readLargeFile(fileEntry.sha, generation)
      : await this.readContentsFile(normalizedPath);

    if (generation === this.generation) this.cache.set(cacheKey, content);
    return content;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const generation = this.generation;
    const normalizedPath = normalizeGitHubPath(path, this.projectDir);
    const cacheKey = buildGitHubBytesCacheKey(this.config.ref, normalizedPath);
    const cached = this.cache.get<Uint8Array>(cacheKey);
    if (cached !== undefined) return cached;

    logger.debug(`${LOG_PREFIX} Reading file as bytes`);

    const fileEntry = this.statOps.getFileEntry(normalizedPath);
    const bytes = fileEntry?.size && fileEntry.size > MAX_CONTENTS_SIZE
      ? await this.readLargeFileBytes(fileEntry.sha, generation)
      : await this.readContentsFileBytes(normalizedPath);

    if (generation === this.generation) this.cache.set(cacheKey, bytes);
    return bytes;
  }

  private async readContentsFile(path: string): Promise<string> {
    const item = await this.getFileItemFromContents(path);
    return this.decodeBase64(item.content);
  }

  private async readContentsFileBytes(path: string): Promise<Uint8Array> {
    const item = await this.getFileItemFromContents(path);
    return this.decodeBase64ToBytes(item.content);
  }

  private async getFileItemFromContents(
    path: string,
  ): Promise<GitHubContentItem & { content: string; encoding: "base64" }> {
    try {
      const response = await this.client.getContents(path);

      if (Array.isArray(response)) {
        throw INVALID_ARGUMENT.create({ message: "Path is a directory" });
      }

      if (response.type !== "file") {
        throw INVALID_ARGUMENT.create({ message: "Path does not identify a file" });
      }

      if (response.content === undefined || response.content === null) {
        throw NETWORK_ERROR.create({ message: "GitHub file response has no content" });
      }

      if (response.encoding !== "base64") {
        throw NETWORK_ERROR.create({ message: "GitHub file content is not base64-encoded" });
      }

      return response as GitHubContentItem & { content: string; encoding: "base64" };
    } catch (error) {
      const statusCode = error instanceof Error
        ? (error as Error & { statusCode?: number }).statusCode
        : undefined;
      if (statusCode === 404) {
        throw FILE_NOT_FOUND.create({ message: "File not found" });
      }
      throw error;
    }
  }

  invalidate(): void {
    this.generation++;
  }

  private async readLargeFile(sha: string, generation: number): Promise<string> {
    const blobCacheKey = `github:blob:${sha}`;
    const cachedBlob = this.cache.get<string>(blobCacheKey);
    if (cachedBlob !== undefined) return cachedBlob;

    logger.debug(`${LOG_PREFIX} Reading large file via Blob API`);

    const blob = await this.client.getBlob(sha);
    const content = blob.encoding === "base64" ? this.decodeBase64(blob.content) : blob.content;

    if (generation === this.generation) this.cache.set(blobCacheKey, content);
    return content;
  }

  private async readLargeFileBytes(sha: string, generation: number): Promise<Uint8Array> {
    const blobCacheKey = `github:blob:bytes:${sha}`;
    const cachedBlob = this.cache.get<Uint8Array>(blobCacheKey);
    if (cachedBlob !== undefined) return cachedBlob;

    logger.debug(`${LOG_PREFIX} Reading large file via Blob API`);

    const blob = await this.client.getBlob(sha);
    const bytes = blob.encoding === "base64"
      ? this.decodeBase64ToBytes(blob.content)
      : new TextEncoder().encode(blob.content);

    if (generation === this.generation) this.cache.set(blobCacheKey, bytes);
    return bytes;
  }

  private decodeBase64ToBytes(content: string): Uint8Array {
    const compact = content.replace(/[\t\n\r ]/g, "");
    const validBase64 = compact === "" || compact.length % 4 === 0 &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact);
    if (!validBase64) {
      throw NETWORK_ERROR.create({ message: "GitHub file content is not valid base64" });
    }

    let binaryString: string;
    try {
      binaryString = atob(compact);
    } catch {
      throw NETWORK_ERROR.create({ message: "GitHub file content is not valid base64" });
    }
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  }

  private decodeBase64(content: string): string {
    const bytes = this.decodeBase64ToBytes(content);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw NETWORK_ERROR.create({ message: "GitHub file content is not valid UTF-8" });
    }
  }
}
