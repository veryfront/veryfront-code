/**
 * Vendor bundle rewriting strategy.
 *
 * Priority: 6
 * Handles: Rewriting React imports to use vendor bundle (browser only)
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class VendorStrategy implements ImportRewriteStrategy {
    readonly name = "vendor";
    readonly priority = 6;
    matches(specifier: string, ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}
export declare const vendorStrategy: VendorStrategy;
//# sourceMappingURL=vendor-strategy.d.ts.map