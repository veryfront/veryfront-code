import { createError, toError } from "../../../../errors/veryfront-error.ts";
import { logger } from "@veryfront/utils";
import type { FileCache } from "../cache/file-cache.ts";
import type { GitHubAPIClient } from "./github-api-client.ts";
import type { GitHubStatOperations } from "./stat-operations.ts";
import type { GitHubContentItem, ResolvedGitHubConfig } from "./types.ts";
import { buildGitHubBytesCacheKey, buildGitHubContentCacheKey } from "../../../../cache/keys.ts";

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
  private readonly projectDir: string;

  constructor(
    config: ResolvedGitHubConfig,
    client: GitHubAPIClient,
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

  /**
   * Read file content as text
   */
  async readTextFile(path: string): Promise<string> {
    const normalizedPath = this.normalizePath(path);

    // Check cache
    const cacheKey = buildGitHubContentCacheKey(this.config.ref, normalizedPath);
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
  async readFile(path: string): Promise<Uint8Array> {
    const normalizedPath = this.normalizePath(path);

    // Check cache for bytes
    const cacheKey = buildGitHubBytesCacheKey(this.config.ref, normalizedPath);
    const cached = this.cache.get<Uint8Array>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    logger.debug(`${LOG_PREFIX} Reading file as bytes`, { path: normalizedPath });

    // Get file entry from index for size check
    const fileEntry = this.statOps.getFileEntry(normalizedPath);

    let bytes: Uint8Array;

    if (fileEntry && fileEntry.size > MAX_CONTENTS_SIZE) {
      // Large file: use Blob API
      bytes = await this.readLargeFileBytes(fileEntry.sha);
    } else {
      // Normal file: use Contents API
      bytes = await this.readContentsFileBytes(normalizedPath);
    }

    // Cache the bytes
    this.cache.set(cacheKey, bytes);

    return bytes;
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
   * Read file as bytes using Contents API
   */
  private async readContentsFileBytes(path: string): Promise<Uint8Array> {
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

      const item = response as GitHubContentItem;

      if (item.type !== "file") {
        throw toError(
          createError({
            type: "file",
            message: `Not a file: ${path} (type: ${item.type})`,
          }),
        );
      }

      if (!item.content) {
        throw toError(
          createError({
            type: "file",
            message: `File has no content: ${path}`,
          }),
        );
      }

      return this.decodeBase64ToBytes(item.content);
    } catch (error) {
      if (
        error instanceof Error &&
        (error as Error & { statusCode?: number }).statusCode === 404
      ) {
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

  /**
   * Read large file as bytes using Blob API
   */
  private async readLargeFileBytes(sha: string): Promise<Uint8Array> {
    const blobCacheKey = `github:blob:bytes:${sha}`;
    const cachedBlob = this.cache.get<Uint8Array>(blobCacheKey);
    if (cachedBlob !== undefined) {
      return cachedBlob;
    }

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

  private normalizePath(path: string): string {
    let normalized = path;
    if (this.projectDir && normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }
    return normalized.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+/g, "/");
  }
}
