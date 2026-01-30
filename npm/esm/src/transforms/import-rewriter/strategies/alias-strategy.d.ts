/**
 * Path alias (@/) import rewriting strategy.
 *
 * Priority: 1
 * Handles: @/components/Button, @/utils/helpers
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class AliasStrategy implements ImportRewriteStrategy {
    readonly name = "alias";
    readonly priority = 1;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
    private getRelativeFilePath;
}
export declare const aliasStrategy: AliasStrategy;
//# sourceMappingURL=alias-strategy.d.ts.map