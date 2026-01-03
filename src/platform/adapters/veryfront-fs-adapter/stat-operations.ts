import { logger } from "@veryfront/utils";
import type { FileInfo } from "../base.ts";
import type { ProjectFile } from "../veryfront-api-client.ts";
import type { VeryfrontAPIClient } from "../veryfront-api-client.ts";
import { FileCache } from "../file-cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

const EXTENSION_PRIORITY = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;

export class StatOperations {
  private fileIndex: Map<string, ProjectFile> | null = null;
  private directoryIndex: Set<string> | null = null;
  private buildingIndex: Promise<void> | null = null;

  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
  ) {}

  async stat(path: string): Promise<FileInfo> {
    const normalizedPath = this.normalizer.normalize(path);
    const branch = this.client.getRequestBranch() || "main";
    const cacheKey = `file:stat:${branch}:${normalizedPath}`;

    const cached = this.cache.get<FileInfo>(cacheKey);
    if (cached) {
      return cached;
    }

    await this.ensureIndexBuilt();

    const fileIdx = this.fileIndex;
    const dirIdx = this.directoryIndex;

    if (!fileIdx || !dirIdx) {
      throw toError(createError({
        type: "file",
        message: `Index not available for: ${normalizedPath}`,
      }));
    }

    const file = fileIdx.get(normalizedPath);
    if (file) {
      const info: FileInfo = {
        size: file.size,
        mtime: new Date(file.updatedAt),
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      };
      this.cache.set(cacheKey, info);
      return info;
    }

    if (dirIdx.has(normalizedPath)) {
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

    throw toError(createError({
      type: "file",
      message: `File not found: ${normalizedPath}`,
    }));
  }

  private async ensureIndexBuilt(): Promise<void> {
    if (this.fileIndex && this.directoryIndex) return;

    if (this.buildingIndex) {
      await this.buildingIndex;
      return;
    }

    this.buildingIndex = this.buildIndex();
    await this.buildingIndex;
    this.buildingIndex = null;
  }

  private async buildIndex(): Promise<void> {
    const allFiles = await this.getAllFilesRaw();
    const fileIdx = new Map<string, ProjectFile>();
    const dirIdx = new Set<string>();

    for (const file of allFiles) {
      fileIdx.set(file.path, file);

      const parts = file.path.split("/");
      let current = "";
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part) {
          current = current ? `${current}/${part}` : part;
          dirIdx.add(current);
        }
      }
    }

    this.fileIndex = fileIdx;
    this.directoryIndex = dirIdx;

    logger.debug("[StatOperations] Index built", {
      files: fileIdx.size,
      directories: dirIdx.size,
    });
  }

  clearIndex(): void {
    this.fileIndex = null;
    this.directoryIndex = null;
  }

  private async getAllFilesRaw(): Promise<ProjectFile[]> {
    const branch = this.client.getRequestBranch() || "main";
    const cacheKey = `files:all:${branch}`;
    const cached = this.cache.get<ProjectFile[]>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug("[StatOperations] Fetching all files from API", { branch });
    const files = await this.client.listAllFiles();
    this.cache.set(cacheKey, files);
    return files;
  }

  async exists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizer.normalize(path);
    try {
      await this.stat(normalizedPath);
      return true;
    } catch {
      return false;
    }
  }

  async resolveFile(basePath: string): Promise<string | null> {
    const normalizedPath = this.normalizer.normalize(basePath);
    const branch = this.client.getRequestBranch() || "main";
    const cacheKey = `file:resolve:${branch}:${normalizedPath}`;

    const cached = this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    await this.ensureIndexBuilt();

    const fileIdx = this.fileIndex;
    if (!fileIdx) {
      return null;
    }

    // 1. Try exact match first
    if (fileIdx.has(normalizedPath)) {
      this.cache.set(cacheKey, normalizedPath);
      return normalizedPath;
    }

    // 2. Check if path already has an extension
    const hasExtension = EXTENSION_PRIORITY.some((ext) => normalizedPath.endsWith(ext));
    const pathWithoutExt = hasExtension
      ? normalizedPath.replace(/\.(mdx|md|tsx|jsx|ts|js)$/, "")
      : normalizedPath;

    // 3. Try each extension in priority order from cached index
    for (const ext of EXTENSION_PRIORITY) {
      const pathWithExt = pathWithoutExt + ext;
      if (fileIdx.has(pathWithExt)) {
        this.cache.set(cacheKey, pathWithExt);
        return pathWithExt;
      }
    }

    // 4. Try index file variants
    for (const ext of EXTENSION_PRIORITY) {
      const indexPath = `${pathWithoutExt}/index${ext}`;
      if (fileIdx.has(indexPath)) {
        this.cache.set(cacheKey, indexPath);
        return indexPath;
      }
    }

    // 5. If not in cache, search via API pattern
    const searchPattern = `${pathWithoutExt}.*`;
    logger.debug("[StatOperations] Searching for file pattern", { pattern: searchPattern });

    try {
      const matches = await this.client.searchFiles(searchPattern);
      if (matches.length > 0) {
        // Sort by extension priority
        const sorted = matches.sort((a, b) => {
          const extA = EXTENSION_PRIORITY.findIndex((ext) => a.path.endsWith(ext));
          const extB = EXTENSION_PRIORITY.findIndex((ext) => b.path.endsWith(ext));
          return (extA === -1 ? 99 : extA) - (extB === -1 ? 99 : extB);
        });
        const first = sorted[0];
        if (first) {
          this.cache.set(cacheKey, first.path);
          return first.path;
        }
      }
    } catch (error) {
      logger.debug("[StatOperations] Pattern search failed", { pattern: searchPattern, error });
    }

    this.cache.set(cacheKey, null);
    return null;
  }
}
