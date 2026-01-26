import { buildGitHubDirCacheKey } from "../../../../cache/index.js";
import { logger } from "../../../../utils/index.js";
const LOG_PREFIX = "[GitHubDirectoryOperations]";
export class GitHubDirectoryOperations {
    config;
    cache;
    statOps;
    projectDir;
    constructor(config, cache, statOps, projectDir = "") {
        this.config = config;
        this.cache = cache;
        this.statOps = statOps;
        this.projectDir = projectDir;
    }
    readdir(path) {
        const normalizedPath = this.normalizePath(path);
        const cacheKey = buildGitHubDirCacheKey(this.config.ref, normalizedPath);
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        logger.debug(`${LOG_PREFIX} Reading directory`, { path: normalizedPath });
        if (normalizedPath && !this.statOps.isDirectory(normalizedPath)) {
            logger.debug(`${LOG_PREFIX} Directory not found`, { path: normalizedPath });
            return [];
        }
        const entries = [];
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
            if (a.isDirectory !== b.isDirectory)
                return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        this.cache.set(cacheKey, entries);
        return entries;
    }
    async *readDir(path) {
        for (const entry of this.readdir(path)) {
            yield entry;
        }
    }
    normalizePath(path) {
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
