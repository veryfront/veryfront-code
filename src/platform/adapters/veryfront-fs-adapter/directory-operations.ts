import { basename, join } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import type { DirectoryEntry } from "./types.ts";
import type { VeryfrontAPIClient } from "../veryfront-api-client.ts";
import { FileCache } from "../file-cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";

export class DirectoryOperations {
  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
  ) {}

  async readdir(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = this.normalizer.normalize(path);
    const cacheKey = `dir:entries:${normalizedPath}`;

    const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
    if (cached) {
      logger.debug("[DirectoryOperations] Cache hit (readdir)", { path: normalizedPath });
      return cached;
    }

    const allFiles = await this.getAllFiles();
    const entries = this.buildDirectoryEntries(normalizedPath, allFiles);

    this.cache.set(cacheKey, entries);

    logger.debug("[DirectoryOperations] Listed directory", {
      path: normalizedPath,
      entries: entries.length,
    });

    return entries;
  }

  private async getAllFiles(): Promise<DirectoryEntry[]> {
    const cacheKey = "files:all";

    const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug("[DirectoryOperations] Fetching all files from API");
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

  private buildDirectoryEntries(
    normalizedPath: string,
    allFiles: DirectoryEntry[],
  ): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [];
    const seenNames = new Set<string>();
    const isRoot = normalizedPath === "" || normalizedPath === "/";
    const prefix = isRoot ? "" : normalizedPath + "/";

    for (const file of allFiles) {
      if (!isRoot && !file.path.startsWith(prefix)) continue;

      const relativePath = isRoot ? file.path : file.path.slice(prefix.length);

      if (relativePath.includes("/")) {
        this.addDirectoryEntry(entries, seenNames, normalizedPath, relativePath);
      } else {
        this.addFileEntry(entries, seenNames, file, relativePath);
      }
    }

    return entries;
  }

  private addDirectoryEntry(
    entries: DirectoryEntry[],
    seenNames: Set<string>,
    normalizedPath: string,
    relativePath: string,
  ): void {
    const dirName = relativePath.split("/")[0];
    if (dirName && !seenNames.has(dirName)) {
      seenNames.add(dirName);
      entries.push({
        name: dirName,
        path: join(normalizedPath, dirName),
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      });
    }
  }

  private addFileEntry(
    entries: DirectoryEntry[],
    seenNames: Set<string>,
    file: DirectoryEntry,
    relativePath: string,
  ): void {
    if (!seenNames.has(relativePath)) {
      seenNames.add(relativePath);
      entries.push({
        name: relativePath,
        path: file.path,
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      });
    }
  }
}
