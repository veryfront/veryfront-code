import { buildGitHubDirCacheKey } from "#veryfront/cache";
import { logger } from "#veryfront/utils";
import type { FileCache } from "../cache/file-cache.ts";
import type { GitHubStatOperations } from "./stat-operations.ts";
import type { DirectoryEntry, ResolvedGitHubConfig } from "./types.ts";
import { normalizeGitHubPath } from "./path-utils.ts";

const LOG_PREFIX = "[GitHubDirectoryOperations]";

export class GitHubDirectoryOperations {
  constructor(
    private readonly config: ResolvedGitHubConfig,
    private readonly cache: FileCache,
    private readonly statOps: GitHubStatOperations,
    private readonly projectDir: string = "",
  ) {}

  readdir(path: string): DirectoryEntry[] {
    const normalizedPath = normalizeGitHubPath(path, this.projectDir);
    const cacheKey = buildGitHubDirCacheKey(this.config.ref, normalizedPath);

    const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
    if (cached) return cached;

    logger.debug(`${LOG_PREFIX} Reading directory`, { path: normalizedPath });

    if (normalizedPath && !this.statOps.isDirectory(normalizedPath)) {
      logger.debug(`${LOG_PREFIX} Directory not found`, { path: normalizedPath });
      return [];
    }

    const entries: DirectoryEntry[] = [
      ...this.statOps.getFilesInDirectory(normalizedPath).map((file) => ({
        name: file.path.split("/").pop() ?? file.path,
        path: file.path,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      })),
      ...this.statOps.getSubdirectories(normalizedPath).map((subdir) => ({
        name: subdir,
        path: normalizedPath ? `${normalizedPath}/${subdir}` : subdir,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
      })),
    ];

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    this.cache.set(cacheKey, entries);
    return entries;
  }

  async *readDir(path: string): AsyncIterable<DirectoryEntry> {
    for (const entry of this.readdir(path)) yield entry;
  }
}
