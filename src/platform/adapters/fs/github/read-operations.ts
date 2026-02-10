import { buildGitHubBytesCacheKey, buildGitHubContentCacheKey } from "#veryfront/cache";
import { createError, toError } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
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
    const normalizedPath = normalizeGitHubPath(path, this.projectDir);
    const cacheKey = buildGitHubContentCacheKey(this.config.ref, normalizedPath);
    const cached = this.cache.get<string>(cacheKey);
    if (cached !== undefined) return cached;

    logger.debug(`${LOG_PREFIX} Reading file`, { path: normalizedPath });

    const fileEntry = this.statOps.getFileEntry(normalizedPath);
    const content = fileEntry?.size && fileEntry.size > MAX_CONTENTS_SIZE
      ? await this.readLargeFile(fileEntry.sha)
      : await this.readContentsFile(normalizedPath);

    this.cache.set(cacheKey, content);
    return content;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const normalizedPath = normalizeGitHubPath(path, this.projectDir);
    const cacheKey = buildGitHubBytesCacheKey(this.config.ref, normalizedPath);
    const cached = this.cache.get<Uint8Array>(cacheKey);
    if (cached !== undefined) return cached;

    logger.debug(`${LOG_PREFIX} Reading file as bytes`, { path: normalizedPath });

    const fileEntry = this.statOps.getFileEntry(normalizedPath);
    const bytes = fileEntry?.size && fileEntry.size > MAX_CONTENTS_SIZE
      ? await this.readLargeFileBytes(fileEntry.sha)
      : await this.readContentsFileBytes(normalizedPath);

    this.cache.set(cacheKey, bytes);
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
  ): Promise<GitHubContentItem & { content: string }> {
    try {
      const response = await this.client.getContents(path);

      if (Array.isArray(response)) {
        throw toError(
          createError({
            type: "file",
            message: `Path is a directory: ${path}`,
          }),
        );
      }

      if (response.type !== "file") {
        throw toError(
          createError({
            type: "file",
            message: `Not a file: ${path} (type: ${response.type})`,
          }),
        );
      }

      if (!response.content) {
        throw toError(
          createError({
            type: "file",
            message: `File has no content: ${path}`,
          }),
        );
      }

      return response as GitHubContentItem & { content: string };
    } catch (error) {
      const statusCode = error instanceof Error
        ? (error as Error & { statusCode?: number }).statusCode
        : undefined;
      if (statusCode === 404) {
        throw toError(
          createError({
            type: "file",
            message: `File not found: ${path}`,
            context: { path, operation: "read" },
          }),
        );
      }
      throw error;
    }
  }

  private async readLargeFile(sha: string): Promise<string> {
    const blobCacheKey = `github:blob:${sha}`;
    const cachedBlob = this.cache.get<string>(blobCacheKey);
    if (cachedBlob !== undefined) return cachedBlob;

    logger.debug(`${LOG_PREFIX} Reading large file via Blob API`, { sha });

    const blob = await this.client.getBlob(sha);
    const content = blob.encoding === "base64" ? this.decodeBase64(blob.content) : blob.content;

    this.cache.set(blobCacheKey, content);
    return content;
  }

  private async readLargeFileBytes(sha: string): Promise<Uint8Array> {
    const blobCacheKey = `github:blob:bytes:${sha}`;
    const cachedBlob = this.cache.get<Uint8Array>(blobCacheKey);
    if (cachedBlob !== undefined) return cachedBlob;

    logger.debug(`${LOG_PREFIX} Reading large file via Blob API`, { sha });

    const blob = await this.client.getBlob(sha);
    const bytes = blob.encoding === "base64"
      ? this.decodeBase64ToBytes(blob.content)
      : new TextEncoder().encode(blob.content);

    this.cache.set(blobCacheKey, bytes);
    return bytes;
  }

  private decodeBase64ToBytes(content: string): Uint8Array {
    const binaryString = atob(content.replace(/\n/g, ""));
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  }

  private decodeBase64(content: string): string {
    return new TextDecoder().decode(this.decodeBase64ToBytes(content));
  }
}
