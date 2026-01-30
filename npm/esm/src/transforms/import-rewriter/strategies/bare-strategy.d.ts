/**
 * Bare npm import rewriting strategy.
 *
 * Priority: 2
 * Handles: lodash, @tanstack/react-query, etc.
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class BareStrategy implements ImportRewriteStrategy {
    readonly name = "bare";
    readonly priority = 2;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}
export declare const bareStrategy: BareStrategy;
//# sourceMappingURL=bare-strategy.d.ts.map