import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { logger } from "@veryfront/utils";
import type { FileCache } from "../file-cache/file-cache.ts";
import type { GitHubAPIClient } from "./github-api-client.ts";
import type { FileIndexEntry, FileInfo, GitHubTreeEntry, ResolvedGitHubConfig } from "./types.ts";

const LOG_PREFIX = "[GitHubStatOperations]";

/** Extensions to try when resolving files */
const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

/**
 * Handles file stat operations and index building for GitHub adapter
 */
export class GitHubStatOperations {
  private readonly config: ResolvedGitHubConfig;
  private readonly client: GitHubAPIClient;
  private readonly cache: FileCache;
  private readonly projectDir: string;

  /** File index built from tree */
  private fileIndex: Map<string, FileIndexEntry> = new Map();

  /** Directory index (set of directory paths) */
  private directoryIndex: Set<string> = new Set();

  /** Promise guard for concurrent index building */
  private buildingIndex: Promise<void> | null = null;

  /** Whether index has been built */
  private indexBuilt = false;

  constructor(
    config: ResolvedGitHubConfig,
    client: GitHubAPIClient,
    cache: FileCache,
    projectDir: string = "",
  ) {
    this.config = config;
    this.client = client;
    this.cache = cache;
    this.projectDir = projectDir;
  }

  /**
   * Build the file index from GitHub tree
   */
  async buildIndex(): Promise<void> {
    // Return existing promise if already building
    if (this.buildingIndex) {
      return this.buildingIndex;
    }

    // Skip if already built
    if (this.indexBuilt) {
      return;
    }

    this.buildingIndex = this.doBuildIndex();

    try {
      await this.buildingIndex;
    } finally {
      this.buildingIndex = null;
    }
  }

  /**
   * Internal index building logic
   */
  private async doBuildIndex(): Promise<void> {
    const cacheKey = `github:tree:${this.client.repoId}:${this.config.ref}`;

    // Try cache first
    const cached = this.cache.get<GitHubTreeEntry[]>(cacheKey);
    if (cached) {
      logger.debug(`${LOG_PREFIX} Using cached tree`);
      this.buildIndexFromEntries(cached);
      this.indexBuilt = true;
      return;
    }

    // Fetch from API
    logger.info(`${LOG_PREFIX} Fetching repository tree`, {
      repo: this.client.repoId,
      ref: this.config.ref,
    });

    const tree = await this.client.getTree();

    // Cache tree entries
    this.cache.set(cacheKey, tree.tree);

    this.buildIndexFromEntries(tree.tree);
    this.indexBuilt = true;

    logger.info(`${LOG_PREFIX} Index built`, {
      files: this.fileIndex.size,
      directories: this.directoryIndex.size,
    });
  }

  /**
   * Build indexes from tree entries
   */
  private buildIndexFromEntries(entries: GitHubTreeEntry[]): void {
    this.fileIndex.clear();
    this.directoryIndex.clear();

    // Root is always a directory
    this.directoryIndex.add("");

    for (const entry of entries) {
      if (entry.type === "blob") {
        // Add file to index
        this.fileIndex.set(entry.path, {
          path: entry.path,
          sha: entry.sha,
          size: entry.size ?? 0,
          type: "blob",
        });

        // Build directory hierarchy
        this.addDirectoryHierarchy(entry.path);
      } else if (entry.type === "tree") {
        // Add directory
        this.directoryIndex.add(entry.path);
      }
    }
  }

  /**
   * Add all parent directories for a file path
   */
  private addDirectoryHierarchy(filePath: string): void {
    const parts = filePath.split("/");
    let current = "";

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part) {
        current = current ? `${current}/${part}` : part;
        this.directoryIndex.add(current);
      }
    }
  }

  /**
   * Get file stat information
   */
  async stat(path: string): Promise<FileInfo> {
    await this.ensureIndex();

    const normalizedPath = this.normalizePath(path);

    logger.debug(`${LOG_PREFIX} stat called`, {
      inputPath: path,
      normalizedPath,
      projectDir: this.projectDir,
      indexSize: this.fileIndex.size,
    });

    // Check cache
    const cacheKey = `github:stat:${this.config.ref}:${normalizedPath}`;
    const cached = this.cache.get<FileInfo>(cacheKey);
    if (cached) {
      return cached;
    }

    // Check file index
    const fileEntry = this.fileIndex.get(normalizedPath);
    if (fileEntry) {
      const info: FileInfo = {
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: fileEntry.size,
        mtime: null, // GitHub doesn't provide mtime in tree/contents API
      };
      this.cache.set(cacheKey, info);
      return info;
    }

    // Check directory index
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

    // Not found
    logger.debug(`${LOG_PREFIX} File not found`, {
      path: normalizedPath,
      indexSize: this.fileIndex.size,
    });

    throw toError(
      createError({
        type: "file",
        message: `File not found: ${normalizedPath}`,
        context: {
          path: normalizedPath,
          operation: "read",
        },
      }),
    );
  }

  /**
   * Check if a file or directory exists
   */
  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a file path, trying various extensions
   */
  async resolveFile(basePath: string): Promise<string | null> {
    await this.ensureIndex();

    const normalizedPath = this.normalizePath(basePath);

    // Check cache
    const cacheKey = `github:resolve:${this.config.ref}:${normalizedPath}`;
    const cached = this.cache.get<string | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Try exact match
    if (this.fileIndex.has(normalizedPath)) {
      this.cache.set(cacheKey, normalizedPath);
      return normalizedPath;
    }

    // Try with extensions
    for (const ext of RESOLVE_EXTENSIONS) {
      const pathWithExt = normalizedPath + ext;
      if (this.fileIndex.has(pathWithExt)) {
        this.cache.set(cacheKey, pathWithExt);
        return pathWithExt;
      }
    }

    // Try index files
    const indexPaths = RESOLVE_EXTENSIONS.map(
      (ext) => `${normalizedPath}/index${ext}`,
    );
    for (const indexPath of indexPaths) {
      if (this.fileIndex.has(indexPath)) {
        this.cache.set(cacheKey, indexPath);
        return indexPath;
      }
    }

    // Try with pages/ prefix
    if (!normalizedPath.startsWith("pages/")) {
      const withPages = `pages/${normalizedPath}`;

      // Try exact
      if (this.fileIndex.has(withPages)) {
        this.cache.set(cacheKey, withPages);
        return withPages;
      }

      // Try with extensions
      for (const ext of RESOLVE_EXTENSIONS) {
        const pathWithExt = withPages + ext;
        if (this.fileIndex.has(pathWithExt)) {
          this.cache.set(cacheKey, pathWithExt);
          return pathWithExt;
        }
      }

      // Try index files
      for (const ext of RESOLVE_EXTENSIONS) {
        const indexPath = `${withPages}/index${ext}`;
        if (this.fileIndex.has(indexPath)) {
          this.cache.set(cacheKey, indexPath);
          return indexPath;
        }
      }
    }

    // Not found
    this.cache.set(cacheKey, null);
    return null;
  }

  /**
   * Get file entry from index
   */
  getFileEntry(path: string): FileIndexEntry | undefined {
    return this.fileIndex.get(this.normalizePath(path));
  }

  /**
   * Get all files in a directory
   */
  getFilesInDirectory(dirPath: string): FileIndexEntry[] {
    const normalizedDir = this.normalizePath(dirPath);
    const prefix = normalizedDir ? `${normalizedDir}/` : "";
    const files: FileIndexEntry[] = [];

    for (const [path, entry] of this.fileIndex) {
      if (path.startsWith(prefix)) {
        // Only include direct children
        const relativePath = path.slice(prefix.length);
        if (!relativePath.includes("/")) {
          files.push(entry);
        }
      }
    }

    return files;
  }

  /**
   * Get subdirectories of a directory
   */
  getSubdirectories(dirPath: string): string[] {
    const normalizedDir = this.normalizePath(dirPath);
    const prefix = normalizedDir ? `${normalizedDir}/` : "";
    const subdirs: Set<string> = new Set();

    for (const dir of this.directoryIndex) {
      if (dir.startsWith(prefix) && dir !== normalizedDir) {
        const relativePath = dir.slice(prefix.length);
        const firstPart = relativePath.split("/")[0];
        if (firstPart) {
          subdirs.add(firstPart);
        }
      }
    }

    return Array.from(subdirs);
  }

  /**
   * Check if directory exists
   */
  isDirectory(path: string): boolean {
    return this.directoryIndex.has(this.normalizePath(path));
  }

  /**
   * Clear the index
   */
  clearIndex(): void {
    this.fileIndex.clear();
    this.directoryIndex.clear();
    this.indexBuilt = false;
    this.buildingIndex = null;
  }

  /**
   * Ensure index is built
   */
  private async ensureIndex(): Promise<void> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }
  }

  /**
   * Normalize a file path, stripping projectDir prefix if present
   */
  private normalizePath(path: string): string {
    let normalized = path;

    // Strip projectDir prefix if present (handles absolute paths from renderer)
    if (this.projectDir && normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }

    return normalized
      .replace(/^\/+/, "") // Remove leading slashes
      .replace(/\/+$/, "") // Remove trailing slashes
      .replace(/\/+/g, "/"); // Collapse multiple slashes
  }
}
