import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { logger } from "@veryfront/utils";
import type { FileCache } from "../file-cache/file-cache.ts";
import type { GitHubAPIClient } from "./github-api-client.ts";
import type { GitHubStatOperations } from "./stat-operations.ts";
import type { GitHubContentItem, ResolvedGitHubConfig } from "./types.ts";

const LOG_PREFIX = "[GitHubReadOperations]";

/** Max file size for Contents API (1MB) */
const MAX_CONTENTS_SIZE = 1024 * 1024;

/**
 * Handles file read operations for GitHub adapter
 */
export class GitHubReadOperations {
  private readonly config: ResolvedGitHubConfig;
  private readonly client: GitHubAPIClient;
  private readonly cache: FileCache;
  private readonly statOps: GitHubStatOperations;

  constructor(
    config: ResolvedGitHubConfig,
    client: GitHubAPIClient,
    cache: FileCache,
    statOps: GitHubStatOperations,
  ) {
    this.config = config;
    this.client = client;
    this.cache = cache;
    this.statOps = statOps;
  }

  /**
   * Read file content as text
   */
  async readTextFile(path: string): Promise<string> {
    const normalizedPath = this.normalizePath(path);

    // Check cache
    const cacheKey = `github:content:${this.config.ref}:${normalizedPath}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    logger.debug(`${LOG_PREFIX} Reading file`, { path: normalizedPath });

    // Get file entry from index for size check
    const fileEntry = this.statOps.getFileEntry(normalizedPath);

    let content: string;

    if (fileEntry && fileEntry.size > MAX_CONTENTS_SIZE) {
      // Large file: use Blob API
      content = await this.readLargeFile(fileEntry.sha);
    } else {
      // Normal file: use Contents API
      content = await this.readContentsFile(normalizedPath);
    }

    // Cache the content
    this.cache.set(cacheKey, content);

    return content;
  }

  /**
   * Read file content as bytes
   */
  async readFile(path: string): Promise<Uint8Array | string> {
    const content = await this.readTextFile(path);

    // For binary files, we might want to return Uint8Array
    // For now, GitHub's API returns base64 which we decode to string
    // If binary handling is needed, we can enhance this later
    return content;
  }

  /**
   * Read file using Contents API
   */
  private async readContentsFile(path: string): Promise<string> {
    try {
      const response = await this.client.getContents(path);

      // Handle array response (directory)
      if (Array.isArray(response)) {
        throw toError(
          createError({
            type: "file",
            message: `Path is a directory: ${path}`,
          }),
        );
      }

      const item = response as GitHubContentItem;

      // Check type
      if (item.type !== "file") {
        throw toError(
          createError({
            type: "file",
            message: `Not a file: ${path} (type: ${item.type})`,
          }),
        );
      }

      // Decode content
      if (!item.content) {
        throw toError(
          createError({
            type: "file",
            message: `File has no content: ${path}`,
          }),
        );
      }

      return this.decodeBase64(item.content);
    } catch (error) {
      // Re-throw with more context if needed
      if (
        error instanceof Error &&
        (error as Error & { statusCode?: number }).statusCode === 404
      ) {
        throw toError(
          createError({
            type: "file",
            message: `File not found: ${path}`,
            context: {
              path,
              operation: "read",
            },
          }),
        );
      }
      throw error;
    }
  }

  /**
   * Read large file using Blob API
   */
  private async readLargeFile(sha: string): Promise<string> {
    // Check blob cache (blobs are immutable, cache forever)
    const blobCacheKey = `github:blob:${sha}`;
    const cachedBlob = this.cache.get<string>(blobCacheKey);
    if (cachedBlob !== undefined) {
      return cachedBlob;
    }

    logger.debug(`${LOG_PREFIX} Reading large file via Blob API`, { sha });

    const blob = await this.client.getBlob(sha);

    const content = blob.encoding === "base64" ? this.decodeBase64(blob.content) : blob.content;

    // Cache blob (immutable content, uses default TTL)
    this.cache.set(blobCacheKey, content);

    return content;
  }

  /**
   * Decode base64 content from GitHub API
   */
  private decodeBase64(content: string): string {
    // GitHub API returns content with newlines in base64
    const cleanContent = content.replace(/\n/g, "");

    // Use built-in atob for base64 decoding (available in Deno)
    return atob(cleanContent);
  }

  /**
   * Normalize a file path
   */
  private normalizePath(path: string): string {
    return path
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\/+/g, "/");
  }
}
