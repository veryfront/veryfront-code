/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations.
 * Executes strategies in priority order with single parse.
 */

import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { applyRewrites, parseAllImports } from "./parse-cache.ts";
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
} from "./strategies/index.ts";
import type { ImportRewriteStrategy, RewriteContext, RewriteResult } from "./types.ts";

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
        const parsed = await parseAllImports(code);
        if (parsed.imports.length === 0) return code;

        const rewrites = new Map<number, { specifier?: string | null; statement?: string }>();

        for (let i = 0; i < parsed.imports.length; i++) {
          const imp = parsed.imports[i]!;
          const result = this.rewriteImport(imp.specifier, imp, ctx);

          if (result.specifier !== null || result.statement !== undefined) {
            rewrites.set(i, result);
          }
        }

        if (rewrites.size === 0) return code;
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
  ): RewriteResult {
    for (const strategy of this.strategies) {
      if (!strategy.matches(specifier, ctx)) continue;

      const result = strategy.rewrite(
        {
          specifier: info.specifier,
          isDynamic: info.isDynamic,
          start: info.start,
          end: info.end,
          statementStart: info.statementStart,
          statementEnd: info.statementEnd,
          raw: info.raw as import("./types.ts").ImportSpecifierInfo["raw"],
        },
        ctx,
      );

      if (result.specifier !== null || result.statement !== undefined) {
        return result;
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
