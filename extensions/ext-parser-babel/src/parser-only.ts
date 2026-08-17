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
    // Hosted configs are authored in TypeScript but can arrive named `.js`, so
    // the extension cannot decide the dialect. TypeScript is a superset, so
    // enabling it always only widens what parses.
    "typescript",
  ];
  // JSX stays extension-driven so `.ts` keeps `<T>x` as a type assertion.
  if (supportsJsx) plugins.push("jsx");
  return plugins;
}

/**
 * Babel-backed parser with the same parse behavior as {@link BabelCodeParser},
 * without loading traversal, generation, or extension runtime dependencies.
 */
export class BabelParseOnlyParser implements BabelParseOnlyParserContract {
  parse(options: ParseOptions): Promise<ASTNode> {
    const filePath = options.filePath?.toLowerCase() ?? "";
    const ast = parser.parse(options.code, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: options.allowReturnOutsideFunction === true ||
        /\.(?:cjs|js)$/.test(filePath),
      plugins: pickPlugins(options.filePath),
    });
    const node: { type: string } = ast;
    return Promise.resolve(node as ASTNode);
  }
}
