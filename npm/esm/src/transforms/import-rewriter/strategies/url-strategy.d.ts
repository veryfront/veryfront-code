/**
 * URL import handling strategy.
 *
 * Priority: 7
 * Handles: esm.sh URLs that need deps added
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class UrlStrategy implements ImportRewriteStrategy {
    readonly name = "url";
    readonly priority = 7;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}
export declare const urlStrategy: UrlStrategy;
//# sourceMappingURL=url-strategy.d.ts.map