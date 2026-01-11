import { logger } from "@veryfront/utils";
import type { DirectoryEntry } from "./types.ts";
import type { ProjectFile, VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import type { ContentContextProvider } from "./read-operations.ts";
import { buildDirCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";

interface DirNode {
  files: Map<string, ProjectFile>;
  dirs: Set<string>;
}

export class DirectoryOperations {
  private dirTree: Map<string, DirNode> | null = null;
  private buildingTree: Promise<void> | null = null;

  constructor(
    private readonly client: VeryfrontAPIClient,
    private readonly cache: FileCache,
    private readonly normalizer: PathNormalizer,
    private readonly contextProvider?: ContentContextProvider,
  ) {}

  async readdir(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = this.normalizer.normalize(path);
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = `${buildDirCacheKeyPrefix(ctx)}:${normalizedPath}`;

    const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
    if (cached) {
      logger.debug("[DirectoryOperations] Cache hit (readdir)", { path: normalizedPath });
      return cached;
    }

    await this.ensureTreeBuilt();

    const tree = this.dirTree;
    if (!tree) {
      return [];
    }

    const node = tree.get(normalizedPath);
    if (!node) {
      return [];
    }

    const entries: DirectoryEntry[] = [];

    for (const dirName of node.dirs) {
      entries.push({
        name: dirName,
        path: normalizedPath ? `${normalizedPath}/${dirName}` : dirName,
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      });
    }

    for (const [fileName, file] of node.files) {
      entries.push({
        name: fileName,
        path: file.path,
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      });
    }

    this.cache.set(cacheKey, entries);

    logger.debug("[DirectoryOperations] Listed directory", {
      path: normalizedPath,
      entries: entries.length,
    });

    return entries;
  }

  private async ensureTreeBuilt(): Promise<void> {
    if (this.dirTree) return;

    if (this.buildingTree) {
      await this.buildingTree;
      return;
    }

    this.buildingTree = this.buildTree();
    await this.buildingTree;
    this.buildingTree = null;
  }

  private async buildTree(): Promise<void> {
    const allFiles = await this.getAllFilesRaw();
    const tree = new Map<string, DirNode>();
    tree.set("", { files: new Map(), dirs: new Set() });

    for (const file of allFiles) {
      // Normalize path: remove leading and trailing slashes, filter empty parts
      let normalizedPath = file.path.replace(/^\/+/, "").replace(/\/+$/, "");

      // Handle paths that end with "/" (like "pages/") - treat as index file
      // The API sometimes returns "pages/" for the root page instead of "pages/index.mdx"
      if (file.path.endsWith("/")) {
        // Determine extension from file type - default to .mdx for pages
        const ext = file.type === "page" ? ".mdx" : ".tsx";
        normalizedPath = normalizedPath + "/index" + ext;
        logger.debug("[DirectoryOperations] Normalized trailing slash path", {
          original: file.path,
          normalized: normalizedPath,
        });
      }

      const parts = normalizedPath.split("/").filter(Boolean);
      const fileName = parts.pop();
      if (!fileName) continue;

      let currentPath = "";
      for (const part of parts) {
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        let parentNode = tree.get(parentPath);
        if (!parentNode) {
          parentNode = { files: new Map(), dirs: new Set() };
          tree.set(parentPath, parentNode);
        }
        parentNode.dirs.add(part);

        if (!tree.has(currentPath)) {
          tree.set(currentPath, { files: new Map(), dirs: new Set() });
        }
      }

      const dirPath = parts.join("/");
      let dirNode = tree.get(dirPath);
      if (!dirNode) {
        dirNode = { files: new Map(), dirs: new Set() };
        tree.set(dirPath, dirNode);
      }
      dirNode.files.set(fileName, file);
    }

    this.dirTree = tree;
    logger.debug("[DirectoryOperations] Tree built", {
      directories: tree.size,
    });
  }

  clearTree(): void {
    this.dirTree = null;
  }

  private async getAllFilesRaw(): Promise<ProjectFile[]> {
    const ctx = this.contextProvider?.getContentContext();
    const cacheKey = buildFileListCacheKey(ctx);

    const cached = this.cache.get<ProjectFile[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch based on source type
    const isPublished = ctx?.sourceType !== "branch";
    logger.debug("[DirectoryOperations] Fetching files from API", {
      sourceType: ctx?.sourceType,
      cacheKey,
    });

    let files: ProjectFile[];
    if (isPublished) {
      files = await this.client.listPublishedFiles(undefined, ctx?.releaseId ?? undefined);
    } else {
      files = await this.client.listAllFiles();
    }

    this.cache.set(cacheKey, files);
    return files;
  }
}
