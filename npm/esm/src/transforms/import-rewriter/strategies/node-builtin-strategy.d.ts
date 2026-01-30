/**
 * Node.js built-in module strategy.
 *
 * Priority: 0.5 (before React, since node: is clearly not an npm package)
 * Handles: node:async_hooks, node:fs, node:path, etc.
 *
 * For SSR: Keep as-is (Deno/Node resolve natively).
 * For browser: Replace with polyfill modules from src/platform/polyfills/.
 *
 * Known polyfills provide correct API shapes (e.g. AsyncLocalStorage no-op).
 * Unknown builtins map to a generic noop export so the import doesn't crash.
 */
import type { ImportRewriteStrategy, ImportSpecifierInfo, RewriteContext, RewriteResult } from "../types.js";
export declare class NodeBuiltinStrategy implements ImportRewriteStrategy {
    readonly name = "node-builtin";
    readonly priority = 0.5;
    matches(specifier: string, _ctx: RewriteContext): boolean;
    rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult;
}
export declare const nodeBuiltinStrategy: NodeBuiltinStrategy;
//# sourceMappingURL=node-builtin-strategy.d.ts.map