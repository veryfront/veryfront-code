/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations.
 * Executes strategies in priority order with single parse.
 */
import type { ImportRewriteStrategy, RewriteContext } from "./types.js";
export interface RewriteOptions {
    /** Custom strategies to use instead of defaults */
    strategies?: ImportRewriteStrategy[];
    /** Enable debug logging */
    debug?: boolean;
}
export declare class UnifiedImportRewriter {
    private strategies;
    constructor(options?: RewriteOptions);
    /**
     * Rewrite all imports in the code.
     */
    rewrite(code: string, ctx: RewriteContext): Promise<string>;
    /**
     * Rewrite a single import specifier.
     */
    private rewriteImport;
}
/**
 * Default instance for common use.
 */
export declare const defaultRewriter: UnifiedImportRewriter;
/**
 * Rewrite imports using default configuration.
 */
export declare function rewriteImports(code: string, ctx: RewriteContext): Promise<string>;
//# sourceMappingURL=unified-rewriter.d.ts.map