import { buildGitHubBytesCacheKey, buildGitHubContentCacheKey } from "../../../../cache/index.js";
import { createError, toError } from "../../../../errors/index.js";
import { logger } from "../../../../utils/index.js";
const LOG_PREFIX = "[GitHubReadOperations]";
/** Max file size for Contents API (1MB) */
const MAX_CONTENTS_SIZE = 1024 * 1024;
export class GitHubReadOperations {
    config;
    client;
    cache;
    statOps;
    projectDir;
    constructor(config, client, cache, statOps, projectDir = "") {
        this.config = config;
        this.client = client;
        this.cache = cache;
        this.statOps = statOps;
        this.projectDir = projectDir;
    }
    async readTextFile(path) {
        const normalizedPath = this.normalizePath(path);
        const cacheKey = buildGitHubContentCacheKey(this.config.ref, normalizedPath);
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        logger.debug(`${LOG_PREFIX} Reading file`, { path: normalizedPath });
        const fileEntry = this.statOps.getFileEntry(normalizedPath);
        const content = fileEntry?.size && fileEntry.size > MAX_CONTENTS_SIZE
            ? await this.readLargeFile(fileEntry.sha)
            : await this.readContentsFile(normalizedPath);
        this.cache.set(cacheKey, content);
        return content;
    }
    async readFile(path) {
        const normalizedPath = this.normalizePath(path);
        const cacheKey = buildGitHubBytesCacheKey(this.config.ref, normalizedPath);
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        logger.debug(`${LOG_PREFIX} Reading file as bytes`, { path: normalizedPath });
        const fileEntry = this.statOps.getFileEntry(normalizedPath);
        const bytes = fileEntry?.size && fileEntry.size > MAX_CONTENTS_SIZE
            ? await this.readLargeFileBytes(fileEntry.sha)
            : await this.readContentsFileBytes(normalizedPath);
        this.cache.set(cacheKey, bytes);
        return bytes;
    }
    async readContentsFile(path) {
        const item = await this.getFileItemFromContents(path);
        return this.decodeBase64(item.content);
    }
    async readContentsFileBytes(path) {
        const item = await this.getFileItemFromContents(path);
        return this.decodeBase64ToBytes(item.content);
    }
    async getFileItemFromContents(path) {
        try {
            const response = await this.client.getContents(path);
            if (Array.isArray(response)) {
                throw toError(createError({
                    type: "file",
                    message: `Path is a directory: ${path}`,
                }));
            }
            const item = response;
            if (item.type !== "file") {
                throw toError(createError({
                    type: "file",
                    message: `Not a file: ${path} (type: ${item.type})`,
                }));
            }
            if (!item.content) {
                throw toError(createError({
                    type: "file",
                    message: `File has no content: ${path}`,
                }));
            }
            return item;
        }
        catch (error) {
            if (error instanceof Error && error.statusCode === 404) {
                throw toError(createError({
                    type: "file",
                    message: `File not found: ${path}`,
                    context: { path, operation: "read" },
                }));
            }
            throw error;
        }
    }
    async readLargeFile(sha) {
        const blobCacheKey = `github:blob:${sha}`;
        const cachedBlob = this.cache.get(blobCacheKey);
        if (cachedBlob !== undefined) {
            return cachedBlob;
        }
        logger.debug(`${LOG_PREFIX} Reading large file via Blob API`, { sha });
        const blob = await this.client.getBlob(sha);
        const content = blob.encoding === "base64" ? this.decodeBase64(blob.content) : blob.content;
        this.cache.set(blobCacheKey, content);
        return content;
    }
    async readLargeFileBytes(sha) {
        const blobCacheKey = `github:blob:bytes:${sha}`;
        const cachedBlob = this.cache.get(blobCacheKey);
        if (cachedBlob !== undefined) {
            return cachedBlob;
        }
        logger.debug(`${LOG_PREFIX} Reading large file via Blob API`, { sha });
        const blob = await this.client.getBlob(sha);
        const bytes = blob.encoding === "base64"
            ? this.decodeBase64ToBytes(blob.content)
            : new TextEncoder().encode(blob.content);
        this.cache.set(blobCacheKey, bytes);
        return bytes;
    }
    decodeBase64ToBytes(content) {
        const binaryString = atob(content.replace(/\n/g, ""));
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
    decodeBase64(content) {
        return new TextDecoder().decode(this.decodeBase64ToBytes(content));
    }
    normalizePath(path) {
        let normalized = path;
        if (this.projectDir && normalized.startsWith(this.projectDir)) {
            normalized = normalized.slice(this.projectDir.length);
        }
        return normalized.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+/g, "/");
    }
}
