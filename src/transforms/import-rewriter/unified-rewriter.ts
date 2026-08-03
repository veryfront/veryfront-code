/**
 * Unified Import Rewriter.
 *
 * Single entry point for all import transformations.
 * Executes strategies in priority order with single parse.
 */

import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { rewriteWithImportRewriteCore } from "./core.ts";
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
import { assetStrategy } from "./strategies/asset-strategy.ts";
import type { ImportRewriteStrategy, RewriteContext } from "./types.ts";

/**
 * Default strategy execution order by priority.
 */
const DEFAULT_STRATEGIES: ImportRewriteStrategy[] = [
  nodeBuiltinStrategy, // 0.5 - Node.js built-ins (noop for browser)
  assetStrategy, // 0.6 - static assets are not modules; reject with a pointer
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
      () => rewriteWithImportRewriteCore({ code, context: ctx, strategies: this.strategies }),
      {
        "transform.target": ctx.target,
        "transform.file": ctx.filePath.split("/").pop() ?? ctx.filePath,
      },
    );
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
