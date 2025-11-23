import { basename } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import type { FileInfo } from "../base.ts";
import type { DirectoryEntry } from "./types.ts";
import type { VeryfrontAPIClient } from "../veryfront-api-client.ts";
import { FileCache } from "../file-cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export class StatOperations {
  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
  ) {}

  async stat(path: string): Promise<FileInfo> {
    const normalizedPath = this.normalizer.normalize(path);
    const cacheKey = `file:stat:${normalizedPath}`;

    const cached = this.cache.get<FileInfo>(cacheKey);
    if (cached) {
      logger.debug("[StatOperations] Cache hit (stat)", { path: normalizedPath });
      return cached;
    }

    const metadata = await this.client.getFileMetadata(normalizedPath);

    if (!metadata) {
      return this.statDirectory(normalizedPath, cacheKey);
    }

    const info: FileInfo = {
      size: metadata.size,
      mtime: new Date(metadata.updatedAt),
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    };

    this.cache.set(cacheKey, info);
    return info;
  }

  async exists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizer.normalize(path);
    try {
      await this.stat(normalizedPath);
      return true;
    } catch (error) {
      logger.debug(`File stat check failed for ${normalizedPath}:`, error);
      return false;
    }
  }

  private async statDirectory(normalizedPath: string, cacheKey: string): Promise<FileInfo> {
    const allFiles = await this.getAllFiles();
    const isDirectory = allFiles.some((f) => f.path.startsWith(normalizedPath + "/"));

    if (!isDirectory) {
      throw toError(createError({
        type: "file",
        message: `File not found: ${normalizedPath}`,
      }));
    }

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

  private async getAllFiles(): Promise<DirectoryEntry[]> {
    const cacheKey = "files:all";

    const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug("[StatOperations] Fetching all files from API");
    const files = await this.client.listAllFiles();

    const entries: DirectoryEntry[] = files.map((file) => ({
      name: basename(file.path),
      path: file.path,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    }));

    this.cache.set(cacheKey, entries);
    return entries;
  }
}
