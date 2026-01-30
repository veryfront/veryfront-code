/**
 * React import rewriting strategy.
 *
 * Priority: 0 (first)
 * Handles: react, react-dom, react/*, react-dom/*
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class ReactStrategy implements ImportRewriteStrategy {
    readonly name = "react";
    readonly priority = 0;
    private importMapCache;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
    private getImportMap;
}
export declare const reactStrategy: ReactStrategy;
//# sourceMappingURL=react-strategy.d.ts.map