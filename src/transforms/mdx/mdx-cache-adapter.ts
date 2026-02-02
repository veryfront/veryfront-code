import { rendererLogger as logger } from "#veryfront/utils";
import { computeContentHash } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { MdxBundle } from "#veryfront/types";

export interface MDXCompilationResult extends MdxBundle {
  headings?: Array<{ id: string; text: string; level: number }>;
  nodeMap?: Map<number, unknown>;
}

export interface MDXCacheAdapterOptions {
  config: VeryfrontConfig;
  mode: "development" | "production";
}

// Simple in-memory cache for MDX compilations
const mdxCache = new LRUCache<string, MDXCompilationResult>({ maxEntries: 500 });

export class MDXCacheAdapter {
  private mode: "development" | "production";

  constructor(options: MDXCacheAdapterOptions) {
    this.mode = options.mode;
  }

  private getCacheKey(contentHash: string): string {
    return `mdx:${this.mode}:${contentHash}`;
  }

  computeHash(content: string): Promise<string> {
    return computeContentHash(content);
  }

  async getCachedBundle(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MDXCompilationResult | undefined> {
    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = this.getCacheKey(contentHash);

      const cached = mdxCache.get(cacheKey);
      if (!cached) return undefined;

      logger.debug("[mdx-cache] Cache hit for MDX compilation", { filePath, cacheKey });

      return {
        ...cached,
        frontmatter: (frontmatter ?? cached.frontmatter) as Record<
          string,
          string | number | boolean | string[]
        >,
      };
    } catch (error) {
      logger.debug("[mdx-cache] Failed to retrieve cached bundle", { error, filePath });
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

      mdxCache.set(cacheKey, bundle);

      logger.debug("[mdx-cache] Cached compiled MDX", { filePath, cacheKey });
    } catch (error) {
      logger.debug("[mdx-cache] Failed to cache bundle", { error, filePath });
    }
  }

  async invalidateBundle(content: string): Promise<void> {
    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = this.getCacheKey(contentHash);

      mdxCache.delete(cacheKey);
      logger.debug("[mdx-cache] Invalidated cached bundle", { cacheKey });
    } catch {
      // Ignore errors
    }
  }

  invalidateSource(_source: string): number {
    // Simple cache doesn't track source - clear all instead
    mdxCache.clear();
    return 0;
  }

  clearAll(): void {
    mdxCache.clear();
    logger.debug("[mdx-cache] Cleared all cached bundles");
  }

  getStats(): { totalBundles: number; totalSize: number } {
    return { totalBundles: mdxCache.size, totalSize: 0 };
  }
}
