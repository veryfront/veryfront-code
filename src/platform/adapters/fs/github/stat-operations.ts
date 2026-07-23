import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
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

const LOG_PREFIX = "[GitHubStatOperations]";
const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

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
    const pending = this.doBuildIndex(generation);
    this.buildingIndex = pending;

    try {
      await pending;
    } finally {
      if (this.buildingIndex === pending) this.buildingIndex = null;
    }
  }

  private async doBuildIndex(generation: number): Promise<void> {
    const cacheKey = buildGitHubTreeCacheKey(this.client.repoId, this.config.ref);
    const cached = this.cache.get<GitHubTreeEntry[]>(cacheKey);

    if (cached) {
      logger.debug(`${LOG_PREFIX} Using cached tree`);
      this.commitIndex(cached, generation);
      return;
    }

    logger.debug(`${LOG_PREFIX} Fetching repository tree`);

    const tree = await this.client.getTree();
    if (generation !== this.indexGeneration) return;

    this.cache.set(cacheKey, tree.tree);
    this.commitIndex(tree.tree, generation);

    logger.debug(`${LOG_PREFIX} Index built`, {
      files: this.fileIndex.size,
      directories: this.directoryIndex.size,
    });
  }

  private commitIndex(entries: GitHubTreeEntry[], generation: number): void {
    if (generation !== this.indexGeneration) return;

    const fileIndex = new Map<string, FileIndexEntry>();
    const directoryIndex = new Set<string>([""]);

    for (const entry of entries) {
      if (entry.type === "blob") {
        fileIndex.set(entry.path, {
          path: entry.path,
          sha: entry.sha,
          size: entry.size ?? 0,
          type: "blob",
        });
        this.addDirectoryHierarchy(entry.path, directoryIndex);
        continue;
      }

      if (entry.type === "tree") {
        directoryIndex.add(entry.path);
        this.addDirectoryHierarchy(entry.path, directoryIndex);
      }
    }

    this.fileIndex = fileIndex;
    this.directoryIndex = directoryIndex;
    this.indexBuilt = true;
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

  async stat(path: string): Promise<FileInfo> {
    await this.ensureIndex();

    const normalizedPath = normalizeGitHubPath(path, this.projectDir);

    logger.debug(`${LOG_PREFIX} stat called`, { indexSize: this.fileIndex.size });

    const cacheKey = buildGitHubStatCacheKey(this.config.ref, normalizedPath);
    const cached = this.cache.get<FileInfo>(cacheKey);
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
      this.cache.set(cacheKey, info);
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
      this.cache.set(cacheKey, info);
      return info;
    }

    logger.debug(`${LOG_PREFIX} File not found`, { indexSize: this.fileIndex.size });
    throw FILE_NOT_FOUND.create({ message: "File not found" });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "file-not-found") return false;
      throw error;
    }
  }

  async resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    await this.ensureIndex();

    const normalizedPath = normalizeGitHubPath(basePath, this.projectDir);
    const pagesPrefixMode = options?.allowPagesPrefix === false ? "without-pages" : "with-pages";
    const cacheKey = `${
      buildGitHubResolveCacheKey(this.config.ref, normalizedPath)
    }:${pagesPrefixMode}`;
    const cached = this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) return cached;

    const resolved = this.tryResolve(normalizedPath) ??
      (options?.allowPagesPrefix === false ? null : this.tryResolveWithPagesPrefix(normalizedPath));

    this.cache.set(cacheKey, resolved);
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
