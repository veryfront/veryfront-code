import { createError, toError } from "../../../../errors/index.js";
import { logger } from "../../../../utils/index.js";
import { buildGitHubResolveCacheKey, buildGitHubStatCacheKey, buildGitHubTreeCacheKey, } from "../../../../cache/index.js";
const LOG_PREFIX = "[GitHubStatOperations]";
const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
export class GitHubStatOperations {
    config;
    client;
    cache;
    projectDir;
    fileIndex = new Map();
    directoryIndex = new Set();
    buildingIndex = null;
    indexBuilt = false;
    constructor(config, client, cache, projectDir = "") {
        this.config = config;
        this.client = client;
        this.cache = cache;
        this.projectDir = projectDir;
    }
    async buildIndex() {
        if (this.buildingIndex)
            return this.buildingIndex;
        if (this.indexBuilt)
            return;
        this.buildingIndex = this.doBuildIndex();
        try {
            await this.buildingIndex;
        }
        finally {
            this.buildingIndex = null;
        }
    }
    async doBuildIndex() {
        const cacheKey = buildGitHubTreeCacheKey(this.client.repoId, this.config.ref);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            logger.debug(`${LOG_PREFIX} Using cached tree`);
            this.buildIndexFromEntries(cached);
            this.indexBuilt = true;
            return;
        }
        logger.debug(`${LOG_PREFIX} Fetching repository tree`, {
            repo: this.client.repoId,
            ref: this.config.ref,
        });
        const tree = await this.client.getTree();
        this.cache.set(cacheKey, tree.tree);
        this.buildIndexFromEntries(tree.tree);
        this.indexBuilt = true;
        logger.debug(`${LOG_PREFIX} Index built`, {
            files: this.fileIndex.size,
            directories: this.directoryIndex.size,
        });
    }
    buildIndexFromEntries(entries) {
        this.fileIndex.clear();
        this.directoryIndex.clear();
        this.directoryIndex.add("");
        for (const entry of entries) {
            if (entry.type === "blob") {
                this.fileIndex.set(entry.path, {
                    path: entry.path,
                    sha: entry.sha,
                    size: entry.size ?? 0,
                    type: "blob",
                });
                this.addDirectoryHierarchy(entry.path);
                continue;
            }
            if (entry.type === "tree") {
                this.directoryIndex.add(entry.path);
            }
        }
    }
    addDirectoryHierarchy(filePath) {
        const parts = filePath.split("/");
        let current = "";
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!part)
                continue;
            current = current ? `${current}/${part}` : part;
            this.directoryIndex.add(current);
        }
    }
    async stat(path) {
        await this.ensureIndex();
        const normalizedPath = this.normalizePath(path);
        logger.debug(`${LOG_PREFIX} stat called`, {
            inputPath: path,
            normalizedPath,
            projectDir: this.projectDir,
            indexSize: this.fileIndex.size,
        });
        const cacheKey = buildGitHubStatCacheKey(this.config.ref, normalizedPath);
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        const fileEntry = this.fileIndex.get(normalizedPath);
        if (fileEntry) {
            const info = {
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
            const info = {
                isFile: false,
                isDirectory: true,
                isSymlink: false,
                size: 0,
                mtime: null,
            };
            this.cache.set(cacheKey, info);
            return info;
        }
        logger.debug(`${LOG_PREFIX} File not found`, {
            path: normalizedPath,
            indexSize: this.fileIndex.size,
        });
        throw toError(createError({
            type: "file",
            message: `File not found: ${normalizedPath}`,
            context: { path: normalizedPath, operation: "read" },
        }));
    }
    async exists(path) {
        try {
            await this.stat(path);
            return true;
        }
        catch {
            return false;
        }
    }
    async resolveFile(basePath) {
        await this.ensureIndex();
        const normalizedPath = this.normalizePath(basePath);
        const cacheKey = buildGitHubResolveCacheKey(this.config.ref, normalizedPath);
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined)
            return cached;
        const resolved = this.tryResolve(normalizedPath) ??
            this.tryResolveWithPagesPrefix(normalizedPath);
        this.cache.set(cacheKey, resolved);
        return resolved;
    }
    tryResolve(path) {
        if (this.fileIndex.has(path))
            return path;
        for (const ext of RESOLVE_EXTENSIONS) {
            const withExt = path + ext;
            if (this.fileIndex.has(withExt))
                return withExt;
        }
        for (const ext of RESOLVE_EXTENSIONS) {
            const indexPath = `${path}/index${ext}`;
            if (this.fileIndex.has(indexPath))
                return indexPath;
        }
        return null;
    }
    tryResolveWithPagesPrefix(normalizedPath) {
        if (normalizedPath.startsWith("pages/"))
            return null;
        return this.tryResolve(`pages/${normalizedPath}`);
    }
    getFileEntry(path) {
        return this.fileIndex.get(this.normalizePath(path));
    }
    getFilesInDirectory(dirPath) {
        const normalizedDir = this.normalizePath(dirPath);
        const prefix = normalizedDir ? `${normalizedDir}/` : "";
        const files = [];
        for (const [path, entry] of this.fileIndex) {
            if (!path.startsWith(prefix))
                continue;
            const relativePath = path.slice(prefix.length);
            if (!relativePath.includes("/"))
                files.push(entry);
        }
        return files;
    }
    getSubdirectories(dirPath) {
        const normalizedDir = this.normalizePath(dirPath);
        const prefix = normalizedDir ? `${normalizedDir}/` : "";
        const subdirs = new Set();
        for (const dir of this.directoryIndex) {
            if (!dir.startsWith(prefix) || dir === normalizedDir)
                continue;
            const relativePath = dir.slice(prefix.length);
            const firstPart = relativePath.split("/")[0];
            if (firstPart)
                subdirs.add(firstPart);
        }
        return Array.from(subdirs);
    }
    isDirectory(path) {
        return this.directoryIndex.has(this.normalizePath(path));
    }
    clearIndex() {
        this.fileIndex.clear();
        this.directoryIndex.clear();
        this.indexBuilt = false;
        this.buildingIndex = null;
    }
    async ensureIndex() {
        if (this.indexBuilt)
            return;
        await this.buildIndex();
    }
    normalizePath(path) {
        let normalized = path;
        if (this.projectDir && normalized.startsWith(this.projectDir)) {
            normalized = normalized.slice(this.projectDir.length);
        }
        return normalized.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+/g, "/");
    }
}
