import { rendererLogger as logger } from "@veryfront/utils";
import { wrapError as _wrapError } from "@veryfront/errors";
import {
  type BundleCode,
  type BundleMetadata,
  computeCodeHash,
  computeContentHash,
  getBundleManifestStore,
} from "@veryfront/utils";
import { getBundleManifestTTL } from "@veryfront/utils/bundle-manifest-init.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { MdxBundle } from "@veryfront/types";

export interface MDXCompilationResult extends MdxBundle {
  headings?: Array<{ id: string; text: string; level: number }>;
  nodeMap?: Map<number, unknown>;
}

export interface MDXCacheAdapterOptions {
  config: VeryfrontConfig;
  mode: "development" | "production";
}

export class MDXCacheAdapter {
  private config: VeryfrontConfig;
  private mode: "development" | "production";
  private manifestStore = getBundleManifestStore();

  constructor(options: MDXCacheAdapterOptions) {
    this.config = options.config;
    this.mode = options.mode;
  }

  private getCacheKey(contentHash: string): string {
    return `mdx:${this.mode}:${contentHash}`;
  }

  private getTTL(): number | undefined {
    return getBundleManifestTTL(this.config, this.mode);
  }

  async computeHash(content: string): Promise<string> {
    return await computeContentHash(content);
  }

  async getCachedBundle(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MDXCompilationResult | undefined> {
    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = this.getCacheKey(contentHash);

      const metadata = await this.manifestStore.getBundleMetadata(cacheKey);
      if (!metadata) {
        return undefined;
      }

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
        frontmatter: (frontmatter || {}) as Record<string, string | number | boolean | string[]>,
        headings: (metadata.meta?.headings as Array<{ id: string; text: string; level: number }>) ||
          [],
        nodeMap: new Map(),
      };
    } catch (error) {
      logger.debug("[mdx-cache] Failed to retrieve cached bundle", {
        error,
        filePath,
      });
      return undefined;
    }
  }

  async setCachedBundle(
    content: string,
    bundle: MDXCompilationResult,
    filePath?: string,
  ): Promise<void> {
    if (!bundle.compiledCode) {
      logger.debug("[mdx-cache] No compiled code to cache", { filePath });
      return;
    }

    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = this.getCacheKey(contentHash);

      const bundleCode: BundleCode = {
        code: bundle.compiledCode,
      };

      const codeHash = await computeCodeHash(bundleCode);

      const encoder = new TextEncoder();
      const size = encoder.encode(bundle.compiledCode).length;

      const metadata: BundleMetadata = {
        hash: contentHash,
        codeHash,
        size,
        compiledAt: Date.now(),
        source: filePath || "unknown",
        mode: this.mode,
        meta: {
          type: "mdx",
          reactVersion: (await import("react")).version,
          headings: bundle.headings || [],
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
    } catch (error) {
      logger.debug("[mdx-cache] Failed to cache bundle", {
        error,
        filePath,
      });
    }
  }

  async invalidateBundle(content: string): Promise<void> {
    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = this.getCacheKey(contentHash);
      await this.manifestStore.deleteBundle(cacheKey);
      logger.debug("[mdx-cache] Invalidated cached bundle", { cacheKey });
    } catch (error) {
      logger.debug("[mdx-cache] Failed to invalidate bundle", { error });
    }
  }

  async invalidateSource(source: string): Promise<number> {
    try {
      const count = await this.manifestStore.invalidateSource(source);
      logger.debug("[mdx-cache] Invalidated bundles for source", {
        source,
        count,
      });
      return count;
    } catch (error) {
      logger.debug("[mdx-cache] Failed to invalidate source", {
        error,
        source,
      });
      return 0;
    }
  }

  async clearAll(): Promise<void> {
    try {
      await this.manifestStore.clear();
      logger.debug("[mdx-cache] Cleared all cached bundles");
    } catch (error) {
      logger.debug("[mdx-cache] Failed to clear cache", { error });
    }
  }

  async getStats(): Promise<{
    totalBundles: number;
    totalSize: number;
    oldestBundle?: number;
    newestBundle?: number;
  }> {
    try {
      return await this.manifestStore.getStats();
    } catch (error) {
      logger.debug("[mdx-cache] Failed to get stats", { error });
      return {
        totalBundles: 0,
        totalSize: 0,
      };
    }
  }
}
