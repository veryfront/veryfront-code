/**
 * Relative import rewriting strategy.
 *
 * Priority: 3
 * Handles: ./foo, ../bar
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class RelativeStrategy implements ImportRewriteStrategy {
    readonly name = "relative";
    readonly priority = 3;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
    private getRelativeFilePath;
    private resolveRelativePath;
}
export declare const relativeStrategy: RelativeStrategy;
//# sourceMappingURL=relative-strategy.d.ts.map