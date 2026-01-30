/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations.
 * Executes strategies in priority order with single parse.
 */
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { applyRewrites, parseAllImports } from "./parse-cache.js";
import { aliasStrategy, bareStrategy, crossProjectStrategy, importMapStrategy, nodeBuiltinStrategy, reactStrategy, relativeStrategy, urlStrategy, vendorStrategy, veryfrontStrategy, } from "./strategies/index.js";
/**
 * Default strategy execution order by priority.
 */
const DEFAULT_STRATEGIES = [
    nodeBuiltinStrategy, // 0.5 - Node.js built-ins (noop for browser)
    reactStrategy, // 0 - React packages first
    aliasStrategy, // 1 - @/ aliases
    veryfrontStrategy, // 1.5 - #veryfront/*, veryfront/*
    bareStrategy, // 2 - npm packages (browser)
    relativeStrategy, // 3 - ./relative imports
    crossProjectStrategy, // 4 - cross-project imports
    importMapStrategy, // 5 - import map resolution (SSR)
    vendorStrategy, // 6 - vendor bundle (browser)
    urlStrategy, // 7 - esm.sh URL handling
].sort((a, b) => a.priority - b.priority);
export class UnifiedImportRewriter {
    strategies;
    constructor(options) {
        this.strategies = options?.strategies ?? DEFAULT_STRATEGIES;
    }
    /**
     * Rewrite all imports in the code.
     */
    rewrite(code, ctx) {
        return withSpan("transform.import-rewriter", async () => {
            // Single parse for all strategies
            const parsed = await parseAllImports(code);
            if (parsed.imports.length === 0) {
                return code;
            }
            // Apply strategies to each import
            const rewrites = new Map();
            for (let i = 0; i < parsed.imports.length; i++) {
                const imp = parsed.imports[i];
                const result = this.rewriteImport(imp.specifier, imp, ctx, parsed, code);
                if (result.specifier !== null || result.statement !== undefined) {
                    rewrites.set(i, result);
                }
            }
            if (rewrites.size === 0) {
                return code;
            }
            return applyRewrites(code, parsed, rewrites);
        }, {
            "transform.target": ctx.target,
            "transform.file": ctx.filePath.split("/").pop() ?? ctx.filePath,
        });
    }
    /**
     * Rewrite a single import specifier.
     */
    rewriteImport(specifier, info, ctx, _parsed, _code) {
        for (const strategy of this.strategies) {
            if (strategy.matches(specifier, ctx)) {
                const result = strategy.rewrite({
                    specifier: info.specifier,
                    isDynamic: info.isDynamic,
                    start: info.start,
                    end: info.end,
                    statementStart: info.statementStart,
                    statementEnd: info.statementEnd,
                    raw: info.raw,
                }, ctx);
                // If strategy returns a result, use it
                if (result.specifier !== null || result.statement !== undefined) {
                    return result;
                }
            }
        }
        return { specifier: null };
    }
}
/**
 * Default instance for common use.
 */
export const defaultRewriter = new UnifiedImportRewriter();
/**
 * Rewrite imports using default configuration.
 */
export function rewriteImports(code, ctx) {
    return defaultRewriter.rewrite(code, ctx);
}
