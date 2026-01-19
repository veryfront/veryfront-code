import { logger } from "#veryfront/utils";
import type { FileCache } from "../cache/file-cache.ts";
import type { GitHubStatOperations } from "./stat-operations.ts";
import type { DirectoryEntry, ResolvedGitHubConfig } from "./types.ts";
import { buildGitHubDirCacheKey } from "#veryfront/cache";

const LOG_PREFIX = "[GitHubDirectoryOperations]";

/**
 * Handles directory listing operations for GitHub adapter
 */
export class GitHubDirectoryOperations {
  private readonly config: ResolvedGitHubConfig;
  private readonly cache: FileCache;
  private readonly statOps: GitHubStatOperations;
  private readonly projectDir: string;

  constructor(
    config: ResolvedGitHubConfig,
    cache: FileCache,
    statOps: GitHubStatOperations,
    projectDir: string = "",
  ) {
    this.config = config;
    this.cache = cache;
    this.statOps = statOps;
    this.projectDir = projectDir;
  }

  /**
   * Read directory contents
   */
  readdir(path: string): DirectoryEntry[] {
    const normalizedPath = this.normalizePath(path);

    // Check cache
    const cacheKey = buildGitHubDirCacheKey(this.config.ref, normalizedPath);
    const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug(`${LOG_PREFIX} Reading directory`, { path: normalizedPath });

    // Check if directory exists
    if (normalizedPath && !this.statOps.isDirectory(normalizedPath)) {
      logger.debug(`${LOG_PREFIX} Directory not found`, {
        path: normalizedPath,
      });
      return [];
    }

    const entries: DirectoryEntry[] = [];

    // Get files in directory
    const files = this.statOps.getFilesInDirectory(normalizedPath);
    for (const file of files) {
      const name = file.path.split("/").pop() || file.path;
      entries.push({
        name,
        path: file.path,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      });
    }

    // Get subdirectories
    const subdirs = this.statOps.getSubdirectories(normalizedPath);
    for (const subdir of subdirs) {
      const fullPath = normalizedPath ? `${normalizedPath}/${subdir}` : subdir;
      entries.push({
        name: subdir,
        path: fullPath,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
      });
    }

    // Sort entries: directories first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    // Cache the result
    this.cache.set(cacheKey, entries);

    return entries;
  }

  /**
   * Async generator for readDir compatibility
   */
  async *readDir(path: string): AsyncIterable<DirectoryEntry> {
    const entries = this.readdir(path);
    for (const entry of entries) {
      yield entry;
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
