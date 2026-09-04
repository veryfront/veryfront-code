import { logger as baseLogger } from "#veryfront/utils";
import type { DirectoryEntry } from "./types.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { VeryfrontOperationsBase } from "./base-operations.ts";
import { buildDirCacheKeyPrefix } from "./cache-keys.ts";
import { loadAllProjectFiles } from "./file-list-access.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = baseLogger.component("directory-operations");

interface DirNode {
  files: Map<string, ProjectFile>;
  dirs: Set<string>;
}

export class DirectoryOperations extends VeryfrontOperationsBase {
  private dirTree: Map<string, DirNode> | null = null;
  private buildingTree: Promise<void> | null = null;
  private treeGeneration = 0;

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
      const building = this.buildingTree;
      await building;
      if (this.dirTree) return;
      if (this.buildingTree === building) this.buildingTree = null;
      return await this.ensureTreeBuilt();
    }

    const generation = this.treeGeneration;
    const building = this.buildTree(generation);
    this.buildingTree = building;
    try {
      await building;
    } finally {
      if (this.buildingTree === building) this.buildingTree = null;
    }
    if (!this.dirTree) await this.ensureTreeBuilt();
  }

  private buildTree(generation: number): Promise<void> {
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

        if (generation !== this.treeGeneration) return;
        this.dirTree = tree;
        logger.debug("Tree built", { directories: tree.size });
      },
      { "fs.tree.fileCount": "lazy" },
    );
  }

  clearTree(): void {
    this.treeGeneration += 1;
    this.dirTree = null;
  }

  private getAllFilesRaw(): Promise<ProjectFile[]> {
    return withSpan("fs.veryfront.getAllFilesRaw", () =>
      loadAllProjectFiles({
        client: this.client,
        cache: this.cache,
        contextProvider: this.contextProvider,
        logger,
        operationLabel: "dir",
      }));
  }
}
