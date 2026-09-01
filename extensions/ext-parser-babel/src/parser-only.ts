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
  parse(options: BabelParseOnlyOptions): Promise<ASTNode>;
}

export interface BabelParseOnlyOptions extends ParseOptions {
  /** Decorator grammar to parse, or both for backward compatibility. */
  readonly decoratorMode?: "current" | "compatible";
  /** Source grammar to parse. Defaults to TypeScript for CodeParser compatibility. */
  readonly syntax?: "javascript" | "typescript";
}

/**
 * The path the plugin choice reasons about.
 *
 * Embedded framework sources add a terminal `.src` to the original extension,
 * so remove that wrapper before selecting syntax. Markdown and MDX can reach
 * this parser as compiled JSX, and their authored extension would switch JSX
 * off, so map them onto a JSX-capable path after unwrapping. Nothing else reads
 * this value, and `.ts` keeps `<T>x` as a type assertion.
 */
function parseablePath(
  filePath: string | undefined,
  syntax: "javascript" | "typescript",
): string | undefined {
  if (filePath === undefined) return undefined;
  return filePath
    .replace(/\.src$/i, "")
    .replace(/\.mdx?$/i, syntax === "typescript" ? ".tsx" : ".jsx");
}

function pickPlugins(
  filePath: string | undefined,
  syntax: "javascript" | "typescript",
): parser.ParserPlugin[] {
  const supportsJsx = !filePath ||
    /\.(?:tsx|jsx|js|mjs|cjs)$/.test(filePath);
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
  ];
  // Hosted configs are authored in TypeScript but can arrive named `.js`, so
  // the CodeParser-compatible default cannot infer the dialect from the path.
  if (syntax === "typescript") plugins.push("typescript");
  // JSX stays extension-driven so `.ts` keeps `<T>x` as a type assertion.
  if (supportsJsx) plugins.push("jsx");
  return plugins;
}

function pickLegacyDecoratorPlugins(
  filePath: string | undefined,
  syntax: "javascript" | "typescript",
): parser.ParserPlugin[] {
  return pickPlugins(filePath, syntax).map((plugin) =>
    plugin === "decorators" ? "decorators-legacy" : plugin
  );
}

function isBabelSyntaxError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
  return code === "BABEL_PARSER_SYNTAX_ERROR";
}

function isAstNode(value: unknown): value is ASTNode {
  if (typeof value !== "object" || value === null) return false;
  return typeof Object.getOwnPropertyDescriptor(value, "type")?.value ===
    "string";
}

/**
 * Babel-backed parser with the same parse behavior as {@link BabelCodeParser},
 * without loading traversal, generation, or extension runtime dependencies.
 */
export class BabelParseOnlyParser implements BabelParseOnlyParserContract {
  async parse(options: BabelParseOnlyOptions): Promise<ASTNode> {
    const decoratorMode = options.decoratorMode ?? "compatible";
    const syntax = options.syntax ?? "typescript";
    const filePath = parseablePath(options.filePath, syntax)?.toLowerCase() ?? "";
    const parseOptions: parser.ParserOptions = {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: options.allowReturnOutsideFunction === true ||
        /\.(?:cjs|js)$/.test(filePath),
      plugins: pickPlugins(filePath, syntax),
    };
    const ast = (() => {
      try {
        return parser.parse(options.code, parseOptions);
      } catch (error) {
        if (!isBabelSyntaxError(error) || decoratorMode !== "compatible") {
          throw error;
        }
        try {
          return parser.parse(options.code, {
            ...parseOptions,
            plugins: pickLegacyDecoratorPlugins(
              filePath,
              syntax,
            ),
          });
        } catch {
          // Preserve the primary parser's diagnostic when neither supported
          // decorator dialect accepts the source.
          throw error;
        }
      }
    })();
    if (!isAstNode(ast)) {
      throw new TypeError("Babel returned an invalid parser result");
    }
    return ast;
  }
}
