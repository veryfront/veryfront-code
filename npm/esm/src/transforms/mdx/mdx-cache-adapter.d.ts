import type { VeryfrontConfig } from "../../config/index.js";
import type { MdxBundle } from "../../types/index.js";
export interface MDXCompilationResult extends MdxBundle {
    headings?: Array<{
        id: string;
        text: string;
        level: number;
    }>;
    nodeMap?: Map<number, unknown>;
}
export interface MDXCacheAdapterOptions {
    config: VeryfrontConfig;
    mode: "development" | "production";
}
export declare class MDXCacheAdapter {
    private config;
    private mode;
    private get manifestStore();
    constructor(options: MDXCacheAdapterOptions);
    private getCacheKey;
    private getTTL;
    computeHash(content: string): Promise<string>;
    getCachedBundle(content: string, frontmatter?: Record<string, unknown>, filePath?: string): Promise<MDXCompilationResult | undefined>;
    setCachedBundle(content: string, bundle: MDXCompilationResult, filePath?: string): Promise<void>;
    invalidateBundle(content: string): Promise<void>;
    invalidateSource(source: string): Promise<number>;
    clearAll(): Promise<void>;
    getStats(): Promise<{
        totalBundles: number;
        totalSize: number;
        oldestBundle?: number;
        newestBundle?: number;
    }>;
}
//# sourceMappingURL=mdx-cache-adapter.d.ts.map