/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations.
 * Executes strategies in priority order with single parse.
 */

import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { applyRewrites, parseAllImports, type ParsedImports } from "./parse-cache.js";
import {
  aliasStrategy,
  bareStrategy,
  crossProjectStrategy,
  importMapStrategy,
  nodeBuiltinStrategy,
  reactStrategy,
  relativeStrategy,
  urlStrategy,
  vendorStrategy,
  veryfrontStrategy,
} from "./strategies/index.js";
import type { ImportRewriteStrategy, RewriteContext, RewriteResult } from "./types.js";

/**
 * Default strategy execution order by priority.
 */
const DEFAULT_STRATEGIES: ImportRewriteStrategy[] = [
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

export interface RewriteOptions {
  /** Custom strategies to use instead of defaults */
  strategies?: ImportRewriteStrategy[];
  /** Enable debug logging */
  debug?: boolean;
}

export class UnifiedImportRewriter {
  private strategies: ImportRewriteStrategy[];

  constructor(options?: RewriteOptions) {
    this.strategies = options?.strategies ?? DEFAULT_STRATEGIES;
  }

  /**
   * Rewrite all imports in the code.
   */
  rewrite(code: string, ctx: RewriteContext): Promise<string> {
    return withSpan(
      "transform.import-rewriter",
      async () => {
        // Single parse for all strategies
        const parsed = await parseAllImports(code);

        if (parsed.imports.length === 0) {
          return code;
        }

        // Apply strategies to each import
        const rewrites = new Map<number, { specifier?: string | null; statement?: string }>();

        for (let i = 0; i < parsed.imports.length; i++) {
          const imp = parsed.imports[i]!;
          const result = this.rewriteImport(imp.specifier, imp, ctx, parsed, code);

          if (result.specifier !== null || result.statement !== undefined) {
            rewrites.set(i, result);
          }
        }

        if (rewrites.size === 0) {
          return code;
        }

        return applyRewrites(code, parsed, rewrites);
      },
      {
        "transform.target": ctx.target,
        "transform.file": ctx.filePath.split("/").pop() ?? ctx.filePath,
      },
    );
  }

  /**
   * Rewrite a single import specifier.
   */
  private rewriteImport(
    specifier: string,
    info: {
      specifier: string;
      isDynamic: boolean;
      start: number;
      end: number;
      statementStart: number;
      statementEnd: number;
      raw: unknown;
    },
    ctx: RewriteContext,
    _parsed: ParsedImports,
    _code: string,
  ): RewriteResult {
    for (const strategy of this.strategies) {
      if (strategy.matches(specifier, ctx)) {
        const result = strategy.rewrite(
          {
            specifier: info.specifier,
            isDynamic: info.isDynamic,
            start: info.start,
            end: info.end,
            statementStart: info.statementStart,
            statementEnd: info.statementEnd,
            raw: info.raw as import("./types.js").ImportSpecifierInfo["raw"],
          },
          ctx,
        );

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
export function rewriteImports(code: string, ctx: RewriteContext): Promise<string> {
  return defaultRewriter.rewrite(code, ctx);
}
