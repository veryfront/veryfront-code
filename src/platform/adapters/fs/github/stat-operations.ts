import { createError, fromError, toError } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import {
  buildGitHubResolveCacheKey,
  buildGitHubStatCacheKey,
  buildGitHubTreeCacheKey,
} from "#veryfront/cache";
import type { ResolveFileOptions } from "../../base.ts";
import type { FileCache } from "../cache/file-cache.ts";
import type { GitHubApiClient } from "./github-api-client.ts";
import type { FileIndexEntry, FileInfo, GitHubTreeEntry, ResolvedGitHubConfig } from "./types.ts";
import { normalizeGitHubPath } from "./path-utils.ts";
import { buildGitHubCacheRef } from "./cache-scope.ts";

const LOG_PREFIX = "[GitHubStatOperations]";
const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

function isFileNotFoundError(error: unknown): boolean {
  const data = fromError(error);
  return data?.type === "file" && data.message.startsWith("File not found:");
}

interface GitHubIndexSnapshot {
  fileIndex: Map<string, FileIndexEntry>;
  directoryIndex: Set<string>;
}

export class GitHubStatOperations {
  private readonly config: ResolvedGitHubConfig;
  private readonly client: GitHubApiClient;
  private readonly cache: FileCache;
  private readonly projectDir: string;

  private fileIndex = new Map<string, FileIndexEntry>();
  private directoryIndex = new Set<string>();
  private buildingIndex: Promise<void> | null = null;
  private indexBuilt = false;
  private indexGeneration = 0;

  constructor(
    config: ResolvedGitHubConfig,
    client: GitHubApiClient,
    cache: FileCache,
    projectDir: string = "",
  ) {
    this.config = config;
    this.client = client;
    this.cache = cache;
    this.projectDir = projectDir;
  }

  async buildIndex(): Promise<void> {
    if (this.buildingIndex) return this.buildingIndex;
    if (this.indexBuilt) return;

    const generation = this.indexGeneration;
    const buildingIndex = this.doBuildIndex(generation);
    this.buildingIndex = buildingIndex;

    try {
      await buildingIndex;
    } finally {
      if (this.buildingIndex === buildingIndex) this.buildingIndex = null;
    }
  }

  private async doBuildIndex(generation: number): Promise<void> {
    const cacheKey = buildGitHubTreeCacheKey(this.client.repoId, this.config.ref);
    const cached = await this.cache.getAsync<GitHubTreeEntry[]>(cacheKey);

    if (cached) {
      logger.debug(`${LOG_PREFIX} Using cached tree`);
      this.commitIndex(this.createIndexSnapshot(cached), generation);
      return;
    }

    logger.debug(`${LOG_PREFIX} Fetching repository tree`, {
      repo: this.client.repoId,
      ref: this.config.ref,
    });

    const tree = await this.client.getTree();
    const snapshot = this.createIndexSnapshot(tree.tree);
    this.assertCurrentGeneration(generation);
    await this.cache.setAsync(cacheKey, tree.tree);
    this.assertCurrentGeneration(generation);
    this.commitIndex(snapshot, generation);

    logger.debug(`${LOG_PREFIX} Index built`, {
      files: this.fileIndex.size,
      directories: this.directoryIndex.size,
    });
  }

  private createIndexSnapshot(entries: GitHubTreeEntry[]): GitHubIndexSnapshot {
    const fileIndex = new Map<string, FileIndexEntry>();
    const directoryIndex = new Set<string>([""]);
    const seenPaths = new Set<string>();

    for (const entry of entries) {
      let normalizedPath: string;
      try {
        normalizedPath = normalizeGitHubPath(entry.path);
      } catch (cause) {
        throw new TypeError(`Invalid repository tree path: ${entry.path}`, {
          cause,
        });
      }
      if (!normalizedPath || normalizedPath !== entry.path) {
        throw new TypeError(`Invalid repository tree path: ${entry.path}`);
      }
      if (seenPaths.has(normalizedPath)) {
        throw new TypeError(`Duplicate repository tree path: ${normalizedPath}`);
      }
      seenPaths.add(normalizedPath);

      if (entry.type === "blob") {
        if (
          entry.size !== undefined &&
          (!Number.isSafeInteger(entry.size) || entry.size < 0)
        ) {
          throw new TypeError(`Invalid repository tree size for path: ${normalizedPath}`);
        }
        fileIndex.set(normalizedPath, {
          path: normalizedPath,
          sha: entry.sha,
          size: entry.size ?? 0,
          type: "blob",
        });
        this.addDirectoryHierarchy(normalizedPath, directoryIndex);
        continue;
      }

      if (entry.type === "tree") directoryIndex.add(normalizedPath);
    }
    return { fileIndex, directoryIndex };
  }

  private addDirectoryHierarchy(filePath: string, directoryIndex: Set<string>): void {
    const parts = filePath.split("/");
    let current = "";

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;

      current = current ? `${current}/${part}` : part;
      directoryIndex.add(current);
    }
  }

  private commitIndex(snapshot: GitHubIndexSnapshot, generation: number): void {
    this.assertCurrentGeneration(generation);
    this.fileIndex = snapshot.fileIndex;
    this.directoryIndex = snapshot.directoryIndex;
    this.indexBuilt = true;
  }

  private assertCurrentGeneration(generation: number): void {
    if (generation !== this.indexGeneration) {
      throw new Error("GitHub filesystem index build was invalidated");
    }
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureIndex();

    const normalizedPath = normalizeGitHubPath(path, this.projectDir);

    logger.debug(`${LOG_PREFIX} stat called`, {
      inputPath: path,
      normalizedPath,
      projectDir: this.projectDir,
      indexSize: this.fileIndex.size,
    });

    const cacheKey = buildGitHubStatCacheKey(
      buildGitHubCacheRef(this.config),
      normalizedPath,
    );
    const cached = await this.cache.getAsync<FileInfo>(cacheKey);
    if (cached) return cached;

    const fileEntry = this.fileIndex.get(normalizedPath);
    if (fileEntry) {
      const info: FileInfo = {
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: fileEntry.size,
        mtime: null,
      };
      await this.cache.setAsync(cacheKey, info);
      return info;
    }

    if (this.directoryIndex.has(normalizedPath)) {
      const info: FileInfo = {
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        size: 0,
        mtime: null,
      };
      await this.cache.setAsync(cacheKey, info);
      return info;
    }

    logger.debug(`${LOG_PREFIX} File not found`, {
      path: normalizedPath,
      indexSize: this.fileIndex.size,
    });

    throw toError(
      createError({
        type: "file",
        message: `File not found: ${normalizedPath}`,
        context: { path: normalizedPath, operation: "read" },
      }),
    );
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (_) {
      if (isFileNotFoundError(_)) return false;
      throw _;
    }
  }

  async resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    await this.ensureIndex();

    const normalizedPath = normalizeGitHubPath(basePath, this.projectDir);
    const allowPagesPrefix = options?.allowPagesPrefix !== false;
    const cacheKey = `${
      buildGitHubResolveCacheKey(
        buildGitHubCacheRef(this.config),
        normalizedPath,
      )
    }:${allowPagesPrefix ? "with-pages" : "without-pages"}`;
    const cached = await this.cache.getAsync<string | null>(cacheKey);
    if (cached !== undefined) return cached;

    const resolved = this.tryResolve(normalizedPath) ??
      (allowPagesPrefix ? this.tryResolveWithPagesPrefix(normalizedPath) : null);

    await this.cache.setAsync(cacheKey, resolved);
    return resolved;
  }

  private tryResolve(path: string): string | null {
    if (this.fileIndex.has(path)) return path;

    for (const ext of RESOLVE_EXTENSIONS) {
      const withExt = path + ext;
      if (this.fileIndex.has(withExt)) return withExt;
    }

    for (const ext of RESOLVE_EXTENSIONS) {
      const indexPath = `${path}/index${ext}`;
      if (this.fileIndex.has(indexPath)) return indexPath;
    }

    return null;
  }

  private tryResolveWithPagesPrefix(normalizedPath: string): string | null {
    if (normalizedPath.startsWith("pages/")) return null;
    return this.tryResolve(`pages/${normalizedPath}`);
  }

  getFileEntry(path: string): FileIndexEntry | undefined {
    return this.fileIndex.get(normalizeGitHubPath(path, this.projectDir));
  }

  getFilesInDirectory(dirPath: string): FileIndexEntry[] {
    const normalizedDir = normalizeGitHubPath(dirPath, this.projectDir);
    const prefix = normalizedDir ? `${normalizedDir}/` : "";
    const files: FileIndexEntry[] = [];

    for (const [path, entry] of this.fileIndex) {
      if (!path.startsWith(prefix)) continue;

      const relativePath = path.slice(prefix.length);
      if (!relativePath.includes("/")) files.push(entry);
    }

    return files;
  }

  getSubdirectories(dirPath: string): string[] {
    const normalizedDir = normalizeGitHubPath(dirPath, this.projectDir);
    const prefix = normalizedDir ? `${normalizedDir}/` : "";
    const subdirs = new Set<string>();

    for (const dir of this.directoryIndex) {
      if (!dir.startsWith(prefix) || dir === normalizedDir) continue;

      const relativePath = dir.slice(prefix.length);
      const firstPart = relativePath.split("/")[0];
      if (firstPart) subdirs.add(firstPart);
    }

    return Array.from(subdirs);
  }

  isDirectory(path: string): boolean {
    return this.directoryIndex.has(normalizeGitHubPath(path, this.projectDir));
  }

  clearIndex(): void {
    this.indexGeneration++;
    this.fileIndex.clear();
    this.directoryIndex.clear();
    this.indexBuilt = false;
    this.buildingIndex = null;
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexBuilt) return;
    await this.buildIndex();
  }
}
