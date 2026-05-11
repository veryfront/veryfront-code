/**
 * Shim over the `CodeParser` contract's `injectJsxNodePositions()` method.
 *
 * The actual Babel-based implementation lives in `@veryfront/ext-parser-babel`.
 * Core modules continue to import from this path; the shim resolves the
 * contract at call time. Position injection powers Studio Navigator only —
 * if `ext-parser-babel` is not installed we return the source unchanged rather
 * than fail the SSR path.
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { CodeParser } from "#veryfront/extensions/interfaces/index.ts";

interface TransformOptions {
  filePath: string;
}

export function injectNodePositions(source: string, options: TransformOptions): string {
  const parser = tryResolve<CodeParser>("CodeParser");
  if (!parser) return source;
  return parser.injectJsxNodePositions(source, options);
}
