import { rendererLogger as logger } from "../../utils/index.js";
import { computeCodeHash, computeContentHash, getBundleManifestStore, } from "../../utils/index.js";
import { getBundleManifestTTL } from "../../utils/bundle-manifest-init.js";
export class MDXCacheAdapter {
    config;
    mode;
    // Use getter to always get current store (important for tests that swap stores)
    get manifestStore() {
        return getBundleManifestStore();
    }
    constructor(options) {
        this.config = options.config;
        this.mode = options.mode;
    }
    getCacheKey(contentHash) {
        return `mdx:${this.mode}:${contentHash}`;
    }
    getTTL() {
        return getBundleManifestTTL(this.config, this.mode);
    }
    computeHash(content) {
        return computeContentHash(content);
    }
    async getCachedBundle(content, frontmatter, filePath) {
        try {
            const contentHash = await this.computeHash(content);
            const cacheKey = this.getCacheKey(contentHash);
            const metadata = await this.manifestStore.getBundleMetadata(cacheKey);
            if (!metadata)
                return undefined;
            const bundleCode = await this.manifestStore.getBundleCode(metadata.codeHash);
            if (!bundleCode) {
                logger.debug("[mdx-cache] Metadata found but code missing", {
                    filePath,
                    codeHash: metadata.codeHash,
                });
                return undefined;
            }
            logger.debug("[mdx-cache] Cache hit for MDX compilation", {
                filePath,
                codeHash: metadata.codeHash,
                size: metadata.size,
            });
            return {
                compiledCode: bundleCode.code,
                frontmatter: (frontmatter ?? {}),
                headings: metadata.meta?.headings ??
                    [],
                nodeMap: new Map(),
            };
        }
        catch (error) {
            logger.debug("[mdx-cache] Failed to retrieve cached bundle", { error, filePath });
            return undefined;
        }
    }
    async setCachedBundle(content, bundle, filePath) {
        if (!bundle.compiledCode) {
            logger.debug("[mdx-cache] No compiled code to cache", { filePath });
            return;
        }
        try {
            const contentHash = await this.computeHash(content);
            const cacheKey = this.getCacheKey(contentHash);
            const bundleCode = { code: bundle.compiledCode };
            const codeHash = await computeCodeHash(bundleCode);
            const size = new TextEncoder().encode(bundle.compiledCode).length;
            const metadata = {
                hash: contentHash,
                codeHash,
                size,
                compiledAt: Date.now(),
                source: filePath ?? "unknown",
                mode: this.mode,
                meta: {
                    type: "mdx",
                    reactVersion: (await import("react")).version,
                    headings: bundle.headings ?? [],
                },
            };
            const ttl = this.getTTL();
            await this.manifestStore.setBundleCode(codeHash, bundleCode, ttl);
            await this.manifestStore.setBundleMetadata(cacheKey, metadata, ttl);
            logger.debug("[mdx-cache] Cached compiled MDX", {
                filePath,
                cacheKey,
                codeHash,
                size,
                ttl,
            });
        }
        catch (error) {
            logger.debug("[mdx-cache] Failed to cache bundle", { error, filePath });
        }
    }
    async invalidateBundle(content) {
        try {
            const contentHash = await this.computeHash(content);
            const cacheKey = this.getCacheKey(contentHash);
            await this.manifestStore.deleteBundle(cacheKey);
            logger.debug("[mdx-cache] Invalidated cached bundle", { cacheKey });
        }
        catch (error) {
            logger.debug("[mdx-cache] Failed to invalidate bundle", { error });
        }
    }
    async invalidateSource(source) {
        try {
            const count = await this.manifestStore.invalidateSource(source);
            logger.debug("[mdx-cache] Invalidated bundles for source", { source, count });
            return count;
        }
        catch (error) {
            logger.debug("[mdx-cache] Failed to invalidate source", { error, source });
            return 0;
        }
    }
    async clearAll() {
        try {
            await this.manifestStore.clear();
            logger.debug("[mdx-cache] Cleared all cached bundles");
        }
        catch (error) {
            logger.debug("[mdx-cache] Failed to clear cache", { error });
        }
    }
    async getStats() {
        try {
            return await this.manifestStore.getStats();
        }
        catch (error) {
            logger.debug("[mdx-cache] Failed to get stats", { error });
            return { totalBundles: 0, totalSize: 0 };
        }
    }
}
