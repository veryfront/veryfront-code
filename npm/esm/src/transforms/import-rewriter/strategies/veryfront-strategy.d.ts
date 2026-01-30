/**
 * Veryfront framework import rewriting strategy.
 *
 * Priority: 1.5
 * Handles: #veryfront/*, veryfront/*, @veryfront/*
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class VeryfrontStrategy implements ImportRewriteStrategy {
    readonly name = "veryfront";
    readonly priority = 1.5;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}
export declare const veryfrontStrategy: VeryfrontStrategy;
//# sourceMappingURL=veryfront-strategy.d.ts.map