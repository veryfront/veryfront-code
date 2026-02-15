import { logger as baseLogger } from "#veryfront/utils";
import type { DirectoryEntry } from "./types.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { VeryfrontOperationsBase } from "./base-operations.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
} from "./cache-keys.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { withRetryOnTransient } from "./retry.ts";

const logger = baseLogger.component("directory-operations");

interface DirNode {
  files: Map<string, ProjectFile>;
  dirs: Set<string>;
}

export class DirectoryOperations extends VeryfrontOperationsBase {
  private dirTree: Map<string, DirNode> | null = null;
  private buildingTree: Promise<void> | null = null;

  readdir(path: string): Promise<DirectoryEntry[]> {
    return withSpan(
      "fs.veryfront.readdir",
      async () => {
        const normalizedPath = this.normalizer.normalize(path);
        const ctx = this.contextProvider?.getContentContext();
        const cacheKey = `${buildDirCacheKeyPrefix(ctx)}:${normalizedPath}`;

        const cached = this.cache.get<DirectoryEntry[]>(cacheKey);
        if (cached) {
          logger.debug("Cache hit (readdir)", { path: normalizedPath });
          return cached;
        }

        await this.ensureTreeBuilt();

        const node = this.dirTree?.get(normalizedPath);
        if (!node) return [];

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

        logger.debug("Listed directory", {
          path: normalizedPath,
          entries: entries.length,
        });

        return entries;
      },
      { "fs.path": path },
    );
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

  private buildTree(): Promise<void> {
    return withSpan(
      "fs.veryfront.buildTree",
      async () => {
        const allFiles = await this.getAllFilesRaw();
        const tree = new Map<string, DirNode>();
        tree.set("", { files: new Map(), dirs: new Set() });

        for (const file of allFiles) {
          let normalizedPath = file.path.replace(/^\/+/, "").replace(/\/+$/, "");

          // Handle paths that end with "/" (like "pages/") - treat as index file
          // The API sometimes returns "pages/" for the root page instead of "pages/index.mdx"
          if (file.path.endsWith("/")) {
            const ext = file.type === "page" ? ".mdx" : ".tsx";
            normalizedPath = `${normalizedPath}/index${ext}`;
            logger.debug("Normalized trailing slash path", {
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
        logger.debug("Tree built", { directories: tree.size });
      },
      { "fs.tree.fileCount": "lazy" },
    );
  }

  clearTree(): void {
    this.dirTree = null;
  }

  private getAllFilesRaw(): Promise<ProjectFile[]> {
    return withSpan("fs.veryfront.getAllFilesRaw", async () => {
      const cacheStart = performance.now();
      const ctx = this.contextProvider?.getContentContext();
      const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
      const skipPersistentCache =
        this.contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ?? false;

      const adapterFiles = !skipPersistentCache
        ? await this.contextProvider?.getFileList?.()
        : undefined;

      if (adapterFiles) {
        const cacheMs = Math.round(performance.now() - cacheStart);
        logger.debug("getAllFilesRaw - from adapter cache", {
          cacheMs,
          fileCount: adapterFiles.length,
        });
        return adapterFiles as ProjectFile[];
      }

      const cacheKey = buildFileListCacheKey(ctx);

      if (skipPersistentCache) {
        logger.debug("getAllFilesRaw - skipping persistent cache", {
          cacheKey,
          cacheKeyPrefix,
        });
      }

      const cached = skipPersistentCache
        ? undefined
        : await this.cache.getAsync<ProjectFile[]>(cacheKey);

      const cacheMs = Math.round(performance.now() - cacheStart);
      if (cached) {
        logger.debug("getAllFilesRaw - fallback cache HIT", {
          cacheKey,
          cacheMs,
          fileCount: cached.length,
        });
        return cached;
      }

      logger.warn("getAllFilesRaw - cache MISS, fetching from API", {
        cacheKey,
        cacheMs,
      });

      const isPublished = ctx?.sourceType !== "branch";
      logger.debug("Fetching files from API", {
        sourceType: ctx?.sourceType,
        cacheKey,
      });

      const files = await withRetryOnTransient(
        () =>
          isPublished
            ? this.client.listPublishedFiles(
              undefined,
              ctx?.releaseId ?? undefined,
              ctx?.environmentName ?? undefined,
            )
            : this.client.listAllFiles(),
        "getAllFilesRaw (dir)",
      );

      this.cache.set(cacheKey, files);
      return files;
    });
  }
}
