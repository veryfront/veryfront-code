import type { VeryfrontConfig } from "../config/types.js";
export interface SnippetRenderOptions {
    mode: "development" | "production";
    projectDir: string;
    filePath?: string;
    nonce?: string;
    /** Base URL for module server (e.g., http://localhost:3002) */
    moduleServerUrl?: string;
    /** Project slug for proxy mode (needed to resolve @/ imports) */
    projectSlug?: string;
    /** Project config for styling, theme, and HMR settings */
    config?: VeryfrontConfig;
    /** Entity UUID from Studio to use for page_id (for postMessage communication) */
    pageId?: string;
}
export interface SnippetRenderResult {
    html: string;
    frontmatter: Record<string, unknown>;
}
export declare function getCompiledSnippet(hash: string): string | undefined;
export declare function getCompiledSnippetAsync(hash: string): Promise<string | undefined>;
/**
 * Clear all cached snippets - used during cache invalidation
 * @deprecated Use clearSnippetCacheForProject for multi-tenant deployments
 */
export declare function clearSnippetCache(): void;
export declare function clearSnippetCacheForProject(projectSlug: string): void;
export declare function renderSnippet(mdxContent: string, options: SnippetRenderOptions): Promise<SnippetRenderResult>;
//# sourceMappingURL=snippet-renderer.d.ts.map