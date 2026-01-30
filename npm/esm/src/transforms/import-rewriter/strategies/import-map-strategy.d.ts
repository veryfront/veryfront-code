/**
 * Import map resolution strategy.
 *
 * Priority: 5
 * Handles: SSR bare imports using import map, esm.sh URL remapping
 */
import type { ImportMapConfig, ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
/**
 * Resolve import using import map (follows WHATWG spec).
 */
export declare function resolveImportWithMap(specifier: string, importMap: ImportMapConfig, scope?: string): string | null;
export declare class ImportMapStrategy implements ImportRewriteStrategy {
    readonly name = "import-map";
    readonly priority = 5;
    matches(specifier: string, ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}
export declare const importMapStrategy: ImportMapStrategy;
//# sourceMappingURL=import-map-strategy.d.ts.map