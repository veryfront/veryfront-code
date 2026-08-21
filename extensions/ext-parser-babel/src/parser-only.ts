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

/**
 * The path the plugin choice reasons about.
 *
 * Markdown and MDX can reach this parser as compiled JSX, and the authored
 * `.md` or `.mdx` extension would switch JSX off, so the emitted markup parses
 * as a regular expression and throws "Unterminated regular expression". Map
 * them onto a `.tsx` path for the plugin choice only. Nothing else reads this
 * value, and `.ts` keeps `<T>x` a type assertion because only Markdown paths
 * are rewritten.
 */
function parseablePath(filePath?: string): string | undefined {
  if (filePath === undefined) return undefined;
  return filePath.replace(/\.mdx?$/i, ".tsx");
}

function pickPlugins(filePath?: string): parser.ParserPlugin[] {
  const normalizedPath = filePath?.toLowerCase() ?? "";
  const supportsJsx = !filePath ||
    /\.(?:tsx|jsx|js|mjs|cjs)$/.test(normalizedPath);
  const plugins: parser.ParserPlugin[] = [
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "decorators",
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

function pickLegacyDecoratorPlugins(filePath?: string): parser.ParserPlugin[] {
  return pickPlugins(filePath).map((plugin) =>
    plugin === "decorators" ? "decorators-legacy" : plugin
  );
}

function shouldRetryWithLegacyDecorators(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
  const reasonCode = Object.getOwnPropertyDescriptor(error, "reasonCode")?.value;
  return code === "BABEL_PARSER_SYNTAX_ERROR" &&
    reasonCode === "UnsupportedParameterDecorator";
}

/**
 * Babel-backed parser with the same parse behavior as {@link BabelCodeParser},
 * without loading traversal, generation, or extension runtime dependencies.
 */
export class BabelParseOnlyParser implements BabelParseOnlyParserContract {
  parse(options: ParseOptions): Promise<ASTNode> {
    const filePath = options.filePath?.toLowerCase() ?? "";
    const parseOptions: parser.ParserOptions = {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: options.allowReturnOutsideFunction === true ||
        /\.(?:cjs|js)$/.test(filePath),
      plugins: pickPlugins(parseablePath(options.filePath)),
    };
    const ast = (() => {
      try {
        return parser.parse(options.code, parseOptions);
      } catch (error) {
        if (!shouldRetryWithLegacyDecorators(error)) throw error;
        return parser.parse(options.code, {
          ...parseOptions,
          plugins: pickLegacyDecoratorPlugins(parseablePath(options.filePath)),
        });
      }
    })();
    const node: { type: string } = ast;
    return Promise.resolve(node as ASTNode);
  }
}
