export interface SSRRewriteOptions {
    /** Project slug for multi-project routing */
    projectSlug?: string | null;
    /** Branch name for branch-aware routing */
    branch?: string | null;
    /** Cache buster timestamp */
    cacheBuster?: number;
    /** Cross-project reference (e.g., "demo@0.0") for @/ path rewrites */
    crossProjectRef?: string;
    /** React version to use for import rewrites */
    reactVersion?: string;
}
export declare function applySSRImportRewrites(code: string, options?: SSRRewriteOptions): string;
//# sourceMappingURL=ssr-import-rewriter.d.ts.map