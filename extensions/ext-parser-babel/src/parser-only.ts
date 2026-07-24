/**
 * Parser-only Babel entry for permission-constrained workers.
 *
 * This module deliberately imports only `@babel/parser`. In particular, it
 * must remain independent of the full extension entry's traversal, generation,
 * JSX transformation, extension lifecycle, and environment-sensitive debug
 * dependency graphs.
 *
 * @module extensions/ext-parser-babel/parser-only
 */

import * as parser from "@babel/parser";
import type { ASTNode, ParseOptions } from "veryfront/extensions/parser";

/** The parse-only subset shared with the full `CodeParser` contract. */
export interface BabelParseOnlyParserContract {
  /** Parse source code into a Babel-compatible abstract syntax tree. */
  parse(options: ParseOptions): Promise<ASTNode>;
}

function pickPlugins(filePath?: string): parser.ParserPlugin[] {
  const normalizedPath = filePath?.toLowerCase() ?? "";
  const isTypeScript = /\.(?:tsx?|[cm]ts)$/.test(normalizedPath);
  const supportsJsx = !filePath ||
    /\.(?:tsx|jsx|js|mjs|cjs)$/.test(normalizedPath);
  const plugins: parser.ParserPlugin[] = [
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "decorators-legacy",
    "decoratorAutoAccessors",
    "deprecatedImportAssert",
    "dynamicImport",
    "importAttributes",
    "topLevelAwait",
  ];
  if (isTypeScript || !filePath) plugins.push("typescript");
  if (supportsJsx) plugins.push("jsx");
  return plugins;
}

/**
 * Babel-backed parser with the same parse behavior as {@link BabelCodeParser},
 * without loading traversal, generation, or extension runtime dependencies.
 */
export class BabelParseOnlyParser implements BabelParseOnlyParserContract {
  parse(options: ParseOptions): Promise<ASTNode> {
    const ast = parser.parse(options.code, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction:
        options.filePath?.toLowerCase().endsWith(".cjs") === true,
      plugins: pickPlugins(options.filePath),
    });
    return Promise.resolve(ast as unknown as ASTNode);
  }
}
