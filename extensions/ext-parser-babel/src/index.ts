/**
 * ext-parser-babel: CodeParser implementation backed by @babel/parser,
 * @babel/traverse, @babel/generator, @babel/types.
 *
 * Provides the `CodeParser` contract:
 *  - `parse/traverse/generate`: generic AST pipeline for callers that
 *    want to build custom transforms.
 *  - `hasFunctionDirective(options)`: parser-owned directive detection.
 *  - `findStaticCommonJsImports(options)`: static CommonJS discovery with
 *    Babel lexical and TypeScript binding semantics.
 *  - `injectJsxNodePositions(source, options)`: the Studio Navigator
 *    helper that stamps `data-node-*` attributes onto JSX elements.
 *
 * Core's `src/transforms/plugins/babel-node-positions.ts` is a shim that
 * resolves this contract at call time.
 *
 * @module extensions/ext-parser-babel
 */

import * as traverseModule from "@babel/traverse";
import * as generateModule from "@babel/generator";
import { BUNDLE_ERROR } from "veryfront/errors";
import type { ExtensionFactory } from "veryfront/extensions";
import type {
  ASTNode,
  CodeParser,
  FunctionDirectiveOptions,
  GenerateOptions,
  GenerateResult,
  InjectJsxNodePositionsOptions,
  ParseOptions,
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
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const ArrayIsArray = Array.isArray;
const ArrayPush = Array.prototype.push;
const ArraySome = Array.prototype.some;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const MAX_STATIC_STRING_DEPTH = 16;
const MAX_STATIC_STRING_PARTS = 32;
const MAX_STATIC_STRING_LENGTH = 2_048;

function arrayPush<T>(array: T[], value: T): number {
  return ReflectApply(ArrayPush, array, [value]) as number;
}

function arraySome<T>(array: readonly T[], predicate: (value: T) => boolean): boolean {
  return ReflectApply(ArraySome, array, [predicate]) as boolean;
}

interface PrimitiveEntrySnapshot {
  readonly key: PropertyKey;
  readonly value: unknown;
}

interface PrimitiveOwnerSnapshot {
  readonly owner: unknown;
  readonly entries: readonly PrimitiveEntrySnapshot[];
}

function getOwnPropertyDescriptor(
  owner: unknown,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [owner, key]) as
    | PropertyDescriptor
    | undefined;
}

function capturePrimitiveMethods(owner: unknown): PrimitiveOwnerSnapshot {
  const keys = ReflectApply(ReflectOwnKeys, Reflect, [owner]) as PropertyKey[];
  const entries: PrimitiveEntrySnapshot[] = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = getOwnPropertyDescriptor(owner, key);
    if (typeof descriptor?.value !== "function") continue;
    arrayPush(entries, { key, value: descriptor.value });
  }
  return { owner, entries };
}

const COMMON_JS_ANALYSIS_PRIMITIVES = [
  capturePrimitiveMethods(Array),
  capturePrimitiveMethods(Array.prototype),
  capturePrimitiveMethods(Function.prototype),
  capturePrimitiveMethods(Map.prototype),
  capturePrimitiveMethods(Object),
  capturePrimitiveMethods(Object.prototype),
  capturePrimitiveMethods(RegExp.prototype),
  capturePrimitiveMethods(Set.prototype),
  capturePrimitiveMethods(String.prototype),
  capturePrimitiveMethods(WeakMap.prototype),
  capturePrimitiveMethods(WeakSet.prototype),
] as const;

const COMMON_JS_ANALYSIS_GLOBALS = [
  { key: "Array", value: Array },
  { key: "Function", value: Function },
  { key: "Map", value: Map },
  { key: "Object", value: Object },
  { key: "Promise", value: Promise },
  { key: "RegExp", value: RegExp },
  { key: "Set", value: Set },
  { key: "String", value: String },
  { key: "WeakMap", value: WeakMap },
  { key: "WeakSet", value: WeakSet },
] as const;

function assertCommonJsAnalysisPrimitives(): void {
  let changed = false;
  for (let index = 0; index < COMMON_JS_ANALYSIS_GLOBALS.length; index++) {
    const snapshot = COMMON_JS_ANALYSIS_GLOBALS[index]!;
    if (getOwnPropertyDescriptor(globalThis, snapshot.key)?.value !== snapshot.value) {
      changed = true;
      break;
    }
  }
  for (
    let ownerIndex = 0;
    !changed && ownerIndex < COMMON_JS_ANALYSIS_PRIMITIVES.length;
    ownerIndex++
  ) {
    const snapshot = COMMON_JS_ANALYSIS_PRIMITIVES[ownerIndex]!;
    for (let entryIndex = 0; entryIndex < snapshot.entries.length; entryIndex++) {
      const entry = snapshot.entries[entryIndex]!;
      if (getOwnPropertyDescriptor(snapshot.owner, entry.key)?.value !== entry.value) {
        changed = true;
        break;
      }
    }
  }
  if (changed) {
    throw BUNDLE_ERROR.create({
      message: "CommonJS analysis integrity check failed",
      detail: "Required runtime primitives changed after parser initialization",
      context: { capability: "findStaticCommonJsImports" },
    });
  }
}

const FUNCTION_NODE_TYPES = [
  "ArrowFunctionExpression",
  "ClassMethod",
  "ClassPrivateMethod",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
] as const;

interface BabelBindingPath {
  node: ASTNode;
  parentPath?: BabelBindingPath | null;
}

interface ScopeAwareBabelPath extends BabelBindingPath {
  scope?: {
    getBinding(name: string): { path: BabelBindingPath } | undefined;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

function functionHasDirective(node: ASTNode, directive: string): boolean {
  const body = node.body;
  if (
    !isRecord(body) || body.type !== "BlockStatement" ||
    !ArrayIsArray(body.directives)
  ) {
    return false;
  }

  return arraySome(
    body.directives,
    (entry) => isRecord(entry) && isRecord(entry.value) && entry.value.value === directive,
  );
}

function astNode(value: unknown): ASTNode | undefined {
  return isRecord(value) && typeof value.type === "string" ? value as ASTNode : undefined;
}

function unwrapErasedExpression(node: ASTNode | undefined): ASTNode | undefined {
  while (
    node?.type === "ParenthesizedExpression" || node?.type === "TSAsExpression" ||
    node?.type === "TSInstantiationExpression" || node?.type === "TSNonNullExpression" ||
    node?.type === "TSSatisfiesExpression" || node?.type === "TSTypeAssertion"
  ) {
    node = astNode(node.expression);
  }
  return node;
}

function staticStringValue(node: ASTNode | undefined, depth = 0): string | undefined {
  if (depth > MAX_STATIC_STRING_DEPTH) return undefined;
  node = unwrapErasedExpression(node);
  if (node?.type === "StringLiteral" && typeof node.value === "string") {
    return node.value.length <= MAX_STATIC_STRING_LENGTH ? node.value : undefined;
  }
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = staticStringValue(astNode(node.left), depth + 1);
    const right = staticStringValue(astNode(node.right), depth + 1);
    if (left === undefined || right === undefined) return undefined;
    return left.length + right.length <= MAX_STATIC_STRING_LENGTH ? left + right : undefined;
  }
  if (
    node?.type !== "TemplateLiteral" || !ArrayIsArray(node.expressions) ||
    !ArrayIsArray(node.quasis) || node.quasis.length !== node.expressions.length + 1 ||
    node.quasis.length > MAX_STATIC_STRING_PARTS
  ) {
    return undefined;
  }
  let value = "";
  for (let index = 0; index < node.quasis.length; index++) {
    const quasi = astNode(node.quasis[index]);
    if (!isRecord(quasi?.value) || typeof quasi.value.cooked !== "string") return undefined;
    value += quasi.value.cooked;
    if (value.length > MAX_STATIC_STRING_LENGTH) return undefined;
    if (index >= node.expressions.length) continue;
    const expression = staticStringValue(astNode(node.expressions[index]), depth + 1);
    if (expression === undefined || value.length + expression.length > MAX_STATIC_STRING_LENGTH) {
      return undefined;
    }
    value += expression;
  }
  return value;
}

function memberPropertyName(member: ASTNode): string | undefined {
  const property = unwrapErasedExpression(astNode(member.property));
  return member.computed === true
    ? staticStringValue(property)
    : property?.type === "Identifier" && typeof property.name === "string"
    ? property.name
    : undefined;
}

function commonJsRequireBinding(callee: ASTNode | undefined): "require" | undefined {
  callee = unwrapErasedExpression(callee);
  if (callee?.type === "Identifier" && callee.name === "require") return "require";
  if (callee?.type === "SequenceExpression") {
    if (!ArrayIsArray(callee.expressions) || callee.expressions.length === 0) return undefined;
    return commonJsRequireBinding(astNode(callee.expressions[callee.expressions.length - 1]));
  }
  return undefined;
}

function commonJsModuleObjectBinding(value: ASTNode | undefined): "module" | undefined {
  value = unwrapErasedExpression(value);
  if (value?.type === "Identifier" && value.name === "module") return "module";
  if (value?.type === "SequenceExpression") {
    if (!ArrayIsArray(value.expressions) || value.expressions.length === 0) return undefined;
    return commonJsModuleObjectBinding(astNode(value.expressions[value.expressions.length - 1]));
  }
  if (value?.type !== "MemberExpression" && value?.type !== "OptionalMemberExpression") {
    return undefined;
  }
  return memberPropertyName(value) === "parent"
    ? commonJsModuleObjectBinding(astNode(value.object))
    : undefined;
}

function commonJsRequireMainBinding(value: ASTNode | undefined): "require" | undefined {
  value = unwrapErasedExpression(value);
  if (value?.type !== "MemberExpression" && value?.type !== "OptionalMemberExpression") {
    return undefined;
  }
  return memberPropertyName(value) === "main"
    ? commonJsRequireBinding(astNode(value.object))
    : undefined;
}

function commonJsCallableBinding(callee: ASTNode | undefined): "module" | "require" | undefined {
  callee = unwrapErasedExpression(callee);
  const requireBinding = commonJsRequireBinding(callee);
  if (requireBinding !== undefined) return requireBinding;
  if (callee?.type === "SequenceExpression") {
    if (!ArrayIsArray(callee.expressions) || callee.expressions.length === 0) return undefined;
    return commonJsCallableBinding(astNode(callee.expressions[callee.expressions.length - 1]));
  }
  if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
    return undefined;
  }
  const object = unwrapErasedExpression(astNode(callee.object));
  const propertyName = memberPropertyName(callee);

  if (propertyName === "resolve") {
    return commonJsRequireBinding(object);
  }
  if (propertyName !== "require") return undefined;
  return commonJsModuleObjectBinding(object) ?? commonJsRequireMainBinding(object);
}

interface CommonJsCallTarget {
  readonly binding: "module" | "require";
  readonly specifier: ASTNode | undefined;
}

function callArguments(call: ASTNode): readonly unknown[] | undefined {
  return ArrayIsArray(call.arguments) ? call.arguments : undefined;
}

function commonJsCallTarget(call: ASTNode): CommonJsCallTarget | undefined {
  const args = callArguments(call);
  const callee = unwrapErasedExpression(astNode(call.callee));
  if (
    callee?.type === "CallExpression" || callee?.type === "OptionalCallExpression"
  ) {
    const boundCallee = unwrapErasedExpression(astNode(callee.callee));
    if (
      boundCallee?.type === "MemberExpression" ||
      boundCallee?.type === "OptionalMemberExpression"
    ) {
      if (memberPropertyName(boundCallee) === "bind") {
        const binding = commonJsCallableBinding(astNode(boundCallee.object));
        const boundArgs = callArguments(callee);
        const specifier = boundArgs !== undefined && boundArgs.length >= 2
          ? astNode(boundArgs[1])
          : astNode(args?.[0]);
        return binding === undefined ? undefined : { binding, specifier };
      }
    }
  }
  if (
    callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression"
  ) {
    const method = memberPropertyName(callee);
    if (method === "call") {
      const binding = commonJsCallableBinding(astNode(callee.object));
      return binding === undefined ? undefined : { binding, specifier: astNode(args?.[1]) };
    }
    if (method === "apply") {
      const binding = commonJsCallableBinding(astNode(callee.object));
      const applied = unwrapErasedExpression(astNode(args?.[1]));
      const elements = applied?.type === "ArrayExpression" && ArrayIsArray(applied.elements)
        ? applied.elements
        : undefined;
      return binding === undefined ? undefined : { binding, specifier: astNode(elements?.[0]) };
    }
  }
  const binding = commonJsCallableBinding(callee);
  return binding === undefined ? undefined : { binding, specifier: astNode(args?.[0]) };
}

function isErasedTypeScriptBinding(path: BabelBindingPath): boolean {
  for (
    let current: BabelBindingPath | null | undefined = path;
    current;
    current = current.parentPath
  ) {
    if (current.node.declare === true) return true;
    if (
      (current.node.type === "ImportDeclaration" || current.node.type === "ImportSpecifier" ||
        current.node.type === "TSImportEqualsDeclaration") &&
      current.node.importKind === "type"
    ) {
      return true;
    }
  }
  return false;
}

function namespaceMemberEmitsRuntime(value: unknown): boolean {
  const node = astNode(value);
  if (!node) return false;

  if (node.type === "ExportNamedDeclaration") {
    const declaration = astNode(node.declaration);
    if (declaration !== undefined) return namespaceMemberEmitsRuntime(declaration);
    if (node.exportKind === "type") return false;
    return ArrayIsArray(node.specifiers) &&
      arraySome(node.specifiers, (specifier) => astNode(specifier)?.exportKind !== "type");
  }
  if (node.type === "TSModuleDeclaration") {
    if (node.declare === true) return false;
    const body = astNode(node.body);
    return body?.type === "TSModuleBlock" && ArrayIsArray(body.body) &&
      arraySome(body.body, namespaceMemberEmitsRuntime);
  }
  if (
    node.type === "TSInterfaceDeclaration" || node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSNamespaceExportDeclaration" || node.type === "EmptyStatement"
  ) {
    return false;
  }
  if (
    (node.type === "ImportDeclaration" || node.type === "TSImportEqualsDeclaration") &&
    node.importKind === "type"
  ) {
    return false;
  }
  return true;
}

function bodyHasRuntimeNamespaceBinding(body: unknown, name: string): boolean {
  if (!ArrayIsArray(body)) return false;

  return arraySome(body, (entry) => {
    let declaration = astNode(entry);
    if (declaration?.type === "ExportNamedDeclaration") {
      declaration = astNode(declaration.declaration);
    }
    if (declaration?.type !== "TSModuleDeclaration" || declaration.declare === true) return false;
    const identifier = astNode(declaration.id);
    return identifier?.type === "Identifier" && identifier.name === name &&
      namespaceMemberEmitsRuntime(declaration);
  });
}

function hasRuntimeNamespaceBinding(path: ScopeAwareBabelPath, name: string): boolean {
  for (
    let current: BabelBindingPath | null | undefined = path;
    current;
    current = current.parentPath
  ) {
    if (
      (current.node.type === "Program" || current.node.type === "TSModuleBlock") &&
      bodyHasRuntimeNamespaceBinding(current.node.body, name)
    ) {
      return true;
    }
  }
  return false;
}

function hasRuntimeBinding(path: ScopeAwareBabelPath, name: string): boolean {
  const binding = path.scope?.getBinding(name);
  return (binding !== undefined && !isErasedTypeScriptBinding(binding.path)) ||
    hasRuntimeNamespaceBinding(path, name);
}

class BabelCodeParser extends BabelParseOnlyParser implements CodeParser {
  traverse(ast: ASTNode, visitor: TraverseVisitor): void {
    traverse(ast, visitor);
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

  async findStaticCommonJsImports(
    options: ParseOptions,
  ): Promise<readonly string[]> {
    assertCommonJsAnalysisPrimitives();
    const ast = await this.parse(options);
    assertCommonJsAnalysisPrimitives();
    const imports: string[] = [];
    const visit = (path: ScopeAwareBabelPath) => {
      const target = commonJsCallTarget(path.node);
      if (!target || hasRuntimeBinding(path, target.binding)) return;
      const specifier = staticStringValue(target.specifier);
      if (specifier !== undefined) arrayPush(imports, specifier);
    };
    traverse(ast, {
      CallExpression: visit,
      NewExpression: visit,
      OptionalCallExpression: visit,
    });
    assertCommonJsAnalysisPrimitives();
    return imports;
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
      ctx.logger.debug("[ext-parser-babel] CodeParser registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extBabel;
export { BabelCodeParser };
