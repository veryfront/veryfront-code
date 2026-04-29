/**
 * ext-babel — CodeParser implementation backed by @babel/parser,
 * @babel/traverse, @babel/generator, @babel/types.
 *
 * Provides the `CodeParser` contract:
 *  - `parse/traverse/generate` — generic AST pipeline for callers that
 *    want to build custom transforms.
 *  - `injectJsxNodePositions(source, options)` — the Studio Navigator
 *    helper that stamps `data-node-*` attributes onto JSX elements.
 *
 * Core's `src/transforms/plugins/babel-node-positions.ts` is a shim that
 * resolves this contract at call time.
 *
 * @module extensions/ext-babel
 */

import * as parser from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import * as generateModule from "@babel/generator";
import type { ExtensionFactory } from "veryfront/extensions";
import type {
  ASTNode,
  CodeParser,
  GenerateOptions,
  GenerateResult,
  InjectJsxNodePositionsOptions,
  ParseOptions,
  TraverseVisitor,
} from "veryfront/extensions/interfaces";
import { injectNodePositions } from "./inject-node-positions.ts";

type TraverseFunction = (ast: unknown, opts: Record<string, unknown>) => void;
type GenerateFunction = (
  ast: unknown,
  opts?: Record<string, unknown>,
) => { code: string; map?: unknown };

interface ModuleWithDefault<T> {
  default: T | { default: T };
}

function resolveDefaultExport<T>(mod: unknown): T {
  const m = mod as ModuleWithDefault<T>;
  if (typeof m.default === "function") return m.default as T;

  const nested = m.default as { default?: T } | undefined;
  if (typeof nested?.default === "function") return nested.default as T;

  return mod as T;
}

const traverse: TraverseFunction = resolveDefaultExport<TraverseFunction>(traverseModule);
const generate: GenerateFunction = resolveDefaultExport<GenerateFunction>(generateModule);

function pickPlugins(filePath?: string): parser.ParserPlugin[] {
  const isTypeScript = filePath?.endsWith(".ts") || filePath?.endsWith(".tsx");
  const plugins: parser.ParserPlugin[] = ["jsx"];
  if (isTypeScript || !filePath) plugins.push("typescript");
  return plugins;
}

class BabelCodeParser implements CodeParser {
  parse(options: ParseOptions): Promise<ASTNode> {
    const ast = parser.parse(options.code, {
      sourceType: "module",
      plugins: pickPlugins(options.filePath),
    });
    return Promise.resolve(ast as unknown as ASTNode);
  }

  traverse(ast: ASTNode, visitor: TraverseVisitor): void {
    traverse(ast, visitor as unknown as Record<string, unknown>);
  }

  generate(ast: ASTNode, options?: GenerateOptions): Promise<GenerateResult> {
    const result = generate(ast, {
      sourceMaps: options?.sourceMaps ?? false,
      minified: options?.minified ?? false,
    });
    return Promise.resolve({
      code: result.code,
      map: typeof result.map === "string" ? result.map : undefined,
    });
  }

  injectJsxNodePositions(source: string, options: InjectJsxNodePositionsOptions): string {
    return injectNodePositions(source, options);
  }
}

const extBabel: ExtensionFactory = () => {
  const impl = new BabelCodeParser();
  return {
    name: "ext-babel",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "CodeParser" }],
    setup(ctx) {
      ctx.provide("CodeParser", impl);
      ctx.logger.info("[ext-babel] CodeParser registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extBabel;
export { BabelCodeParser };
