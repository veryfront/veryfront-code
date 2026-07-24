/**
 * ext-parser-babel — CodeParser implementation backed by @babel/parser,
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
 * @module extensions/ext-parser-babel
 */

import * as traverseModule from "@babel/traverse";
import * as generateModule from "@babel/generator";
import type { ExtensionFactory } from "veryfront/extensions";
import type {
  ASTNode,
  CodeParser,
  FunctionDirectiveOptions,
  GenerateOptions,
  GenerateResult,
  InjectJsxNodePositionsOptions,
  TraverseVisitor,
} from "veryfront/extensions/parser";
import { injectNodePositions } from "./inject-node-positions.ts";
import { BabelParseOnlyParser } from "./parser-only.ts";

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

const traverse: TraverseFunction = resolveDefaultExport<TraverseFunction>(
  traverseModule,
);
const generate: GenerateFunction = resolveDefaultExport<GenerateFunction>(
  generateModule,
);

const FUNCTION_NODE_TYPES = [
  "ArrowFunctionExpression",
  "ClassMethod",
  "ClassPrivateMethod",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function functionHasDirective(node: ASTNode, directive: string): boolean {
  const body = node.body;
  if (
    !isRecord(body) || body.type !== "BlockStatement" ||
    !Array.isArray(body.directives)
  ) {
    return false;
  }

  return body.directives.some((entry) =>
    isRecord(entry) && isRecord(entry.value) && entry.value.value === directive
  );
}

class BabelCodeParser extends BabelParseOnlyParser implements CodeParser {
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

  async hasFunctionDirective(
    options: FunctionDirectiveOptions,
  ): Promise<boolean> {
    const ast = await this.parse(options);
    let found = false;
    const visit = (path: { node: ASTNode }) => {
      if (!found && functionHasDirective(path.node, options.directive)) {
        found = true;
      }
    };
    const visitor: TraverseVisitor = {};
    for (const nodeType of FUNCTION_NODE_TYPES) visitor[nodeType] = visit;
    this.traverse(ast, visitor);
    return found;
  }

  injectJsxNodePositions(
    source: string,
    options: InjectJsxNodePositionsOptions,
  ): string {
    return injectNodePositions(source, options);
  }
}

const extBabel: ExtensionFactory = () => {
  const impl = new BabelCodeParser();
  return {
    name: "ext-parser-babel",
    version: "0.1.0",
    contracts: {
      provides: ["CodeParser"],
    },
    capabilities: [],
    setup(ctx) {
      ctx.provide("CodeParser", impl);
      ctx.logger.info("[ext-parser-babel] CodeParser registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extBabel;
export { BabelCodeParser };
