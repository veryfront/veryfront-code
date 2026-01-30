/**
 * Cross-project import rewriting strategy.
 *
 * Priority: 4
 * Handles: myproject@1.0.0/@/path, myproject/@/path
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare function isCrossProjectImport(specifier: string): boolean;
export declare function parseCrossProjectImport(specifier: string): {
    projectSlug: string;
    version: string;
    path: string;
} | null;
export declare class CrossProjectStrategy implements ImportRewriteStrategy {
    readonly name = "cross-project";
    readonly priority = 4;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}
export declare const crossProjectStrategy: CrossProjectStrategy;
//# sourceMappingURL=cross-project-strategy.d.ts.map