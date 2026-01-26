import { buildGitHubDirCacheKey } from "../../../../cache/index.js";
import { logger } from "../../../../utils/index.js";
import type { FileCache } from "../cache/file-cache.js";
import type { GitHubStatOperations } from "./stat-operations.js";
import type { DirectoryEntry, ResolvedGitHubConfig } from "./types.js";

const LOG_PREFIX = "[GitHubDirectoryOperations]";

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

  readdir(path: string): DirectoryEntry[] {
    const normalizedPath = this.normalizePath(path);
    const cacheKey = buildGitHubDirCacheKey(this.config.ref, normalizedPath);

    const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
    if (cached) return cached;

    logger.debug(`${LOG_PREFIX} Reading directory`, { path: normalizedPath });

    if (normalizedPath && !this.statOps.isDirectory(normalizedPath)) {
      logger.debug(`${LOG_PREFIX} Directory not found`, { path: normalizedPath });
      return [];
    }

    const entries: DirectoryEntry[] = [];

    for (const file of this.statOps.getFilesInDirectory(normalizedPath)) {
      const name = file.path.split("/").pop() ?? file.path;
      entries.push({
        name,
        path: file.path,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      });
    }

    for (const subdir of this.statOps.getSubdirectories(normalizedPath)) {
      const fullPath = normalizedPath ? `${normalizedPath}/${subdir}` : subdir;
      entries.push({
        name: subdir,
        path: fullPath,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
      });
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    this.cache.set(cacheKey, entries);

    return entries;
  }

  async *readDir(path: string): AsyncIterable<DirectoryEntry> {
    for (const entry of this.readdir(path)) {
      yield entry;
    }
  }

  private normalizePath(path: string): string {
    let normalized = path;

    // Strip projectDir prefix if present (handles absolute paths from renderer)
    if (this.projectDir && normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }

    return normalized
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\/+/g, "/");
  }
}
