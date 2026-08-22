/**
 * Browser Server-Exports Strip Stage: empties server-only data hooks in the
 * client artifact, then drops the import bindings that only they used.
 *
 * `getServerData`, `getStaticData` and `getStaticPaths` run exclusively on the
 * server, but the browser artifact is compiled from the same source file. Their
 * bodies therefore ship to the client along with everything they import, so a
 * page whose loader reaches `node:crypto` links against the node-builtin noop
 * polyfill and hydration dies with:
 *
 *     The requested module '.../node-noop.js' does not provide an export
 *     named 'createHash'
 *
 * esbuild cannot solve this for us: in transform mode (as opposed to bundle
 * mode) it never drops an import, because it cannot see that the binding was
 * used only by a server-only hook that this pass just emptied.
 *
 * The pass runs on the AST from the `CodeParser` contract, for the same reason
 * `rendering/rsc/export-extractor.ts` does: a module is not text. Matching
 * declarations by hand means a private function that shares a hook's name gets
 * emptied, a `}` inside a regular expression literal ends a body early, and a
 * minified statement parses differently from the one a developer wrote.
 *
 * Two rules keep it conservative:
 *
 * - Only an exported declaration is emptied. A private helper called
 *   `getServerData` is ordinary client code.
 * - An import whose bindings all fall out of use because they were in the
 *   stripped hook's dependency closure is deleted. Reducing it to a side-effect
 *   import keeps the imported module in the browser graph, including any
 *   transitive server-only modules it reaches. Node built-ins and Veryfront
 *   framework imports are also deleted when unused, because their browser
 *   side-effect imports are known unsafe or unnecessary. Other already-unused
 *   imports are still reduced to side-effect imports for compatibility with the
 *   older conservative behavior.
 *
 * Hooks are matched on the name they are *exported* under, not the name they
 * are declared with, because that is what the runtime looks up: the data
 * fetcher and the isolation worker both read `mod.getServerData`. A module
 * writing `export { loadIt as getServerData }` has a server loader whatever it
 * calls the function locally.
 *
 * A module that names a server-only export and cannot be analysed fails the
 * build. This is a server/client boundary: emitting the module unchanged would
 * put the loader, its imports and any credential it closes over into the
 * browser bundle, and a silent leak is worse than a stopped build.
 *
 * What this pass does: it empties hook bodies, drops the module-scope
 * declarations the hooks were the last reader of (so `const API_KEY =
 * getEnv(...)` used only by `getServerData` does not reach the browser), and
 * removes the hook-only imports that leaves unused. What it does NOT do: reason
 * about a value that is *also* read by browser code, or one reached only through
 * an existing bare side-effect import. Those are kept. It is not a general
 * guarantee that every secret stays on the server, but a value used solely by a
 * server-only hook no longer leaks.
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";
import { COMPILATION_ERROR, SERVER_ONLY_IN_CLIENT } from "#veryfront/errors";
import { getErrorCollector } from "#veryfront/observability";
import { getLoaderFromPath, isGeneratedContentOutput } from "../../esm/transform-utils.ts";
import { isTypeScript } from "../context.ts";
import type { TransformContext, TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";

/** Exports that only ever execute on the server. */
export const SERVER_ONLY_EXPORTS = ["getServerData", "getStaticData", "getStaticPaths"];

export interface StripServerOnlyExportsOptions {
  /**
   * Leave imports this pass did not make unused exactly as authored. This is
   * only safe before a later compiler pass can erase unused named imports.
   */
  preserveUnownedUnusedImports?: boolean;
  /**
   * Convert authored source syntax diagnostics into the same tenant-owned
   * compilation error shape as the compiler stage.
   */
  classifySourceParseErrors?: boolean;
}

const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;

// This pass runs before compile, so no compile map exists yet. Checked-in build
// output can still carry a stale map directive, and once a hook is stripped that
// map may point at verbatim server-only source. Match only an actual trailing
// directive so source-map-like text inside authored strings survives.
const SOURCE_MAP_SUFFIX =
  /(^|\r?\n)[\t ]*\/\/[#@][\t ]*sourceMappingURL=[^"'`\s]+[\t ]*(?:\r?\n)?$/;

function dropSourceMapSuffix(code: string): string {
  return code.replace(SOURCE_MAP_SUFFIX, "$1");
}

function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  try {
    const descriptor = ReflectGetOwnPropertyDescriptor(value, key);
    if (
      descriptor !== undefined &&
      ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) === true
    ) {
      return descriptor.value;
    }
  } catch {
    // A hostile proxy cannot provide trusted source-diagnostic evidence.
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isParserSourceDiagnostic(error: unknown): boolean {
  const loc = readOwnDataProperty(error, "loc");
  if (loc !== null && typeof loc === "object") return true;
  if (readOwnDataProperty(error, "code") === "BABEL_PARSE_ERROR") return true;
  return typeof readOwnDataProperty(error, "pos") === "number";
}

function createSourceParseCompilationError(
  filePath: string | undefined,
  cause: unknown,
): Error {
  const loader = getLoaderFromPath(filePath ?? "module.tsx");
  const detail = `ESM transform failed for ${filePath ?? "this module"} ` +
    `(loader: ${loader}): ${errorMessage(cause)}`;
  return COMPILATION_ERROR.create({
    detail,
    cause,
    context: {
      tenantBuildFailure: !isGeneratedContentOutput(filePath) && isParserSourceDiagnostic(cause),
    },
  });
}

/** Source the stub nodes are lifted from, so no node shape is hand-built. */
const STUB_SOURCE = `function __vfStub() { throw new Error("server-only"); }
const __vfStubInit = function () { throw new Error("server-only"); };`;

type Node = Record<string, unknown> & { type: string };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function children(node: Node): Node[] {
  const found: Node[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;

    if (Array.isArray(value)) {
      for (const entry of value) if (isNode(entry)) found.push(entry);
      continue;
    }
    if (isNode(value)) found.push(value);
  }

  return found;
}

function isEcmaScriptIdentifier(name: string): boolean {
  return /^[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*$/u.test(name);
}

function isIntrinsicJsxName(name: string): boolean {
  if (/^[a-z]/.test(name)) return true;
  return !isEcmaScriptIdentifier(name);
}

function jsxElementNameReadsBinding(node: Node): boolean {
  if (node.type !== "JSXIdentifier") return true;
  const name = nodeName(node);
  return name !== null && !isIntrinsicJsxName(name);
}

function isReferenceChildKey(parent: Node, key: string): boolean {
  if (parent.type === "ImportDeclaration" || parent.type === "ImportSpecifier") return false;
  if (parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") {
    return false;
  }
  if (parent.type === "ImportAttribute") return false;
  if (parent.type === "ExportAllDeclaration") return false;
  if (parent.type === "ExportDefaultSpecifier" || parent.type === "ExportNamespaceSpecifier") {
    return false;
  }
  if (parent.type === "ExportSpecifier") return key === "local";
  if (
    parent.type === "ExportNamedDeclaration" && isNode(parent.source) && key === "specifiers"
  ) {
    return false;
  }
  if (
    (parent.type === "JSXOpeningElement" || parent.type === "JSXClosingElement") &&
    key === "name" && isNode(parent.name) && !jsxElementNameReadsBinding(parent.name)
  ) {
    return false;
  }
  if (parent.type === "JSXAttribute" && key === "name") return false;
  if (parent.type === "JSXNamespacedName") return false;
  if (parent.type === "JSXMemberExpression" && key === "property") return false;
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    key === "property" && parent.computed !== true
  ) {
    return false;
  }
  if (
    (parent.type === "ObjectProperty" || parent.type === "ObjectMethod" ||
      parent.type === "ClassMethod" || parent.type === "ClassProperty" ||
      parent.type === "ClassAccessorProperty" || parent.type === "ClassPrivateProperty" ||
      parent.type === "ClassPrivateMethod") &&
    key === "key" && parent.computed !== true
  ) {
    return false;
  }
  if (parent.type === "PrivateName" && key === "id") return false;
  if (
    (parent.type === "TSEnumDeclaration" || parent.type === "TSEnumMember") && key === "id"
  ) {
    return false;
  }
  if (parent.type === "TSQualifiedName" && key === "right") return false;
  if (
    (parent.type === "BreakStatement" || parent.type === "ContinueStatement" ||
      parent.type === "LabeledStatement") && key === "label"
  ) {
    return false;
  }
  if (parent.type === "MetaProperty") return false;
  if (parent.type === "Directive" || parent.type === "DirectiveLiteral") return false;
  return true;
}

function referenceChildren(node: Node): Node[] {
  const found: Node[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" || key === "leadingComments" || key === "trailingComments" ||
      key === "comments" || key === "tokens"
    ) {
      continue;
    }
    if (!isReferenceChildKey(node, key)) continue;

    if (Array.isArray(value)) {
      for (const entry of value) if (isNode(entry)) found.push(entry);
      continue;
    }
    if (isNode(value)) found.push(value);
  }

  return found;
}

/**
 * Walk every node in the tree. Returning `false` from `visit` skips the
 * subtree, which is how import statements stay out of the reference count.
 */
function walk(node: Node, visit: (node: Node) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of referenceChildren(node)) walk(child, visit);
}

/**
 * TypeScript nodes that survive type erasure and emit runtime code.
 *
 * Everything else the TypeScript grammar adds is erased before the module
 * runs, so an identifier read inside it is a type reference and must not keep a
 * binding alive. Getting the split wrong is unsafe in both directions: treating
 * a runtime node as erased deletes live code, and treating an erased node as
 * runtime pins a server-only import into the browser artifact.
 *
 * The list is closed and enumerable, which is the point: it is a decidable
 * question, unlike proving what a module does to an intrinsic. A TypeScript
 * node type this pass does not know is erased by default. Any new TypeScript
 * node type that emits runtime code must be added to this allowlist.
 *
 * The split is invisible while this stage runs after the compile stage, which
 * erases every TypeScript node before this pass sees the module. It exists so
 * the stage stays correct when it runs on authored source.
 */
const RUNTIME_TS_NODE_TYPES = new Set<string>([
  // Value expressions wrapping a value expression plus an erased type operand.
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  // `enum E { A = compute() }` emits an object and evaluates each initialiser.
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  // `namespace N { … }` with a body emits an IIFE over a runtime object.
  "TSModuleDeclaration",
  "TSModuleBlock",
  // `constructor(private dep = fallback())` emits an assignment in the body.
  "TSParameterProperty",
  // `import L = require("./l.ts")` and `import A = N.Sub` both emit a binding.
  "TSImportEqualsDeclaration",
  "TSExternalModuleReference",
  "TSQualifiedName",
  // `export = handler` emits an assignment to the module export.
  "TSExportAssignment",
]);

/**
 * Whether the compiler erases `node` and everything under it, so no identifier
 * inside it is a runtime read.
 *
 * Both reference walkers ask this, and they must ask the same question. A
 * walker that counts a type-position read as a runtime reference keeps the
 * server-only import that binding came from; a walker that skips a runtime
 * TypeScript node reports live code as dead.
 */
/** Whether a node carries decorators, which emit a runtime call even when the
 * declaration they annotate is ambient. */
function nodeHasDecorators(node: Node): boolean {
  const decorators = node.decorators;
  return Array.isArray(decorators) && decorators.length > 0;
}

function isErasedTypeNode(node: Node): boolean {
  // `declare const`, `declare class`, `declare namespace`, `declare enum` and
  // `declare prop: T` are all ambient: they emit nothing.
  //
  // Decorators are the exception. Both tsc and esbuild emit a runtime
  // `__decorate` call for `@audit declare id: string`, so the decorator
  // expression is a real read even though the property it annotates is not.
  // Erasing it here deletes the import the decorator needs and the emitted
  // call then throws a ReferenceError at module evaluation.
  if (node.declare === true) return !nodeHasDecorators(node);
  // `import { type Cfg }`, `export { type Cfg }`, `export type { Cfg }`.
  if (node.importKind === "type" || node.exportKind === "type") return true;
  if (!node.type.startsWith("TS")) return false;
  if (!RUNTIME_TS_NODE_TYPES.has(node.type)) return true;
  // An ambient `declare module "x";` has no body to run.
  return node.type === "TSModuleDeclaration" && !isNode(node.body);
}

function nodeName(value: unknown): string | null {
  if (!isNode(value)) return null;
  const name = value.name;
  return typeof name === "string" ? name : null;
}

function exportName(value: unknown): string | null {
  return isNode(value) ? (stringLiteralText(value) ?? nodeName(value)) : null;
}

function mayNameServerOnlyExport(code: string): boolean {
  if (!/\bexport\b/.test(code)) return false;
  if (SERVER_ONLY_EXPORTS.some((name) => code.includes(name))) return true;
  return code.includes("\\");
}

function bodyOf(ast: ASTNode): Node[] {
  const program = (ast as { program?: unknown }).program;
  const source: Node = isNode(program) ? program : ast;
  const body = source.body;
  return Array.isArray(body) ? body.filter(isNode) : [];
}

/** The stub body and stub initialiser, parsed rather than constructed. */
async function parseStubs(parser: CodeParser): Promise<{ body: Node; init: Node } | null> {
  const ast = await parser.parse({ code: STUB_SOURCE, filePath: "vf-stub.ts" });
  const [fn, variable] = bodyOf(ast);

  const body = fn?.body;
  const declarations = variable?.declarations;
  const init = Array.isArray(declarations) && isNode(declarations[0])
    ? (declarations[0] as Node).init
    : undefined;

  if (!isNode(body) || !isNode(init)) return null;
  return { body, init };
}

type BindingPatternHazard = "computed-key" | "default-value" | "unknown-syntax";

interface BindingPatternAnalysis {
  bindingIds: Node[];
  possibleNames: string[];
  hazards: Set<BindingPatternHazard>;
}

function mergePatternAnalysis(
  target: BindingPatternAnalysis,
  nested: BindingPatternAnalysis,
): void {
  target.bindingIds.push(...nested.bindingIds);
  target.possibleNames.push(...nested.possibleNames);
  for (const hazard of nested.hazards) target.hazards.add(hazard);
}

/**
 * Classify one binding pattern without confusing its bindings with expressions
 * evaluated while destructuring. Unknown syntax stays visible as a hazard so a
 * server-hook dependency can fail closed instead of silently leaving code in
 * the browser artifact.
 */
function analyzeBindingPattern(value: unknown): BindingPatternAnalysis {
  const analysis: BindingPatternAnalysis = {
    bindingIds: [],
    possibleNames: [],
    hazards: new Set(),
  };
  if (!isNode(value)) {
    analysis.hazards.add("unknown-syntax");
    return analysis;
  }

  if (value.type === "Identifier") {
    const name = nodeName(value);
    analysis.bindingIds.push(value);
    if (name) analysis.possibleNames.push(name);
    else analysis.hazards.add("unknown-syntax");
    return analysis;
  }

  if (value.type === "AssignmentPattern") {
    analysis.hazards.add("default-value");
    mergePatternAnalysis(analysis, analyzeBindingPattern(value.left));
    return analysis;
  }

  if (value.type === "RestElement") {
    mergePatternAnalysis(analysis, analyzeBindingPattern(value.argument));
    return analysis;
  }

  // `constructor(private dep: Dep)` binds `dep` as a parameter and assigns
  // it to `this` at runtime.
  if (value.type === "TSParameterProperty") {
    mergePatternAnalysis(analysis, analyzeBindingPattern(value.parameter));
    return analysis;
  }

  if (value.type === "ArrayPattern") {
    for (const element of Array.isArray(value.elements) ? value.elements : []) {
      if (element === null || element === undefined) continue;
      mergePatternAnalysis(analysis, analyzeBindingPattern(element));
    }
    return analysis;
  }

  if (value.type === "ObjectPattern") {
    for (const property of Array.isArray(value.properties) ? value.properties : []) {
      if (!isNode(property)) {
        analysis.hazards.add("unknown-syntax");
        continue;
      }
      if (property.type === "RestElement") {
        mergePatternAnalysis(analysis, analyzeBindingPattern(property.argument));
        continue;
      }
      if (property.type !== "ObjectProperty") {
        mergePatternAnalysis(analysis, analyzeBindingPattern(property));
        analysis.hazards.add("unknown-syntax");
        continue;
      }
      if (property.computed === true) analysis.hazards.add("computed-key");
      mergePatternAnalysis(analysis, analyzeBindingPattern(property.value));
    }
    return analysis;
  }

  // Preserve every identifier as a possible binding for the conservative
  // error decision, but never add it to bindingIds: its position is unknown.
  walk(value, (node) => {
    if (node.type !== "Identifier") return true;
    const name = nodeName(node);
    if (name) analysis.possibleNames.push(name);
    return true;
  });
  analysis.hazards.add("unknown-syntax");
  return analysis;
}

/** Every binding name a destructuring pattern introduces. */
function patternBoundNames(pattern: Node): string[] {
  return analyzeBindingPattern(pattern).bindingIds.map(nodeName).filter(
    (name): name is string => Boolean(name),
  );
}

/**
 * The local declarations this module exports under a server-only name, plus the
 * export forms that carry a server-only name but have no local declaration to
 * empty.
 *
 * Keyed on the *exported* name, because that is what the runtime looks up:
 * `mod.getServerData` in the data fetcher and the isolation worker. A module
 * writing `export { loadIt as getServerData }` really does have a server
 * loader, and the fact that it is called `loadIt` locally is invisible to
 * everything downstream.
 */
function exportedHookBindings(body: Node[]): { locals: Set<string>; unhandled: string[] } {
  const locals = new Set<string>();
  const unhandled: string[] = [];
  const isHook = (name: string | null | undefined): name is string =>
    name != null && SERVER_ONLY_EXPORTS.includes(name);

  for (const statement of body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.exportKind === "type") continue;

    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      if (!isNode(specifier)) continue;
      if (specifier.exportKind === "type") continue;
      const exported = exportName(specifier.exported);
      if (!isHook(exported)) continue;

      // `export { x as getServerData } from "./loader"` never binds `x` here,
      // so there is no body to empty and the module it points at is still
      // pulled into the graph.
      if (isNode(statement.source)) {
        unhandled.push(`export { … as ${exported} } from …`);
        continue;
      }

      const local = nodeName(specifier.local);
      if (local) locals.add(local);
    }

    const declaration = statement.declaration;
    if (!isNode(declaration)) continue;

    const direct = nodeName(declaration.id);
    if (isHook(direct)) locals.add(direct);

    for (
      const declarator of Array.isArray(declaration.declarations) ? declaration.declarations : []
    ) {
      if (!isNode(declarator)) continue;
      const id = declarator.id;
      if (!isNode(id)) continue;

      const name = nodeName(id);
      if (name) {
        if (isHook(name)) locals.add(name);
        continue;
      }

      // `export const { getServerData } = loaders`: the initialiser is a value
      // this pass cannot take apart.
      if (patternBoundNames(id).some(isHook)) {
        unhandled.push("export const { … } = …");
      }
    }
  }

  for (const statement of body) {
    if (statement.type !== "TSImportEqualsDeclaration") continue;
    const name = nodeName(statement.id);
    if (name && (locals.has(name) || (statement.isExport === true && isHook(name)))) {
      unhandled.push(`import ${name} = require(…)`);
    }
  }

  return { locals, unhandled };
}

/**
 * Empty the body of every exported server-only hook. Emptying rather than
 * deleting keeps the binding, so an export clause or re-export stays valid.
 */
function emptyServerOnlyHooks(
  body: Node[],
  targets: Set<string>,
  stubs: { body: Node; init: Node },
): boolean {
  if (targets.size === 0) return false;

  let changed = false;

  const declarationsIn = (statement: Node): Node[] => {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    return isNode(declaration) ? [declaration] : [];
  };

  for (const statement of body) {
    for (const declaration of declarationsIn(statement)) {
      if (declaration.type === "FunctionDeclaration") {
        const name = nodeName(declaration.id);
        if (!name || !targets.has(name)) continue;
        declaration.params = [];
        declaration.body = structuredClone(stubs.body);
        changed = true;
        continue;
      }

      if (declaration.type !== "VariableDeclaration") continue;

      for (
        const declarator of Array.isArray(declaration.declarations) ? declaration.declarations : []
      ) {
        if (!isNode(declarator)) continue;
        const name = nodeName(declarator.id);
        if (!name || !targets.has(name)) continue;
        declarator.init = structuredClone(stubs.init);
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Identifiers the module reads, ignoring import statements and the positions
 * where an identifier is a fixed name rather than a reference (`a.hashOf`,
 * `{ hashOf: 1 }`). This flat walk is used for module-declaration liveness;
 * import liveness uses the scope-aware walker below.
 *
 * `excluded` holds identifier nodes that are binding *positions* rather than
 * references (the `id` a declaration introduces), so a declaration is not
 * counted as a use of itself when deciding whether it is dead.
 */
function referencedIdentifiers(body: Node[], excluded?: WeakSet<Node>): Set<string> {
  const referenced = new Set<string>();
  // Filled in as each parent is visited, which always happens before its
  // children.
  const fixedNames = new WeakSet<Node>();

  const markFixedName = (node: Node): void => {
    const property = node.type === "MemberExpression" || node.type === "OptionalMemberExpression"
      ? node.property
      : node.type === "ObjectProperty" || node.type === "ObjectMethod" ||
          node.type === "ClassMethod" || node.type === "ClassProperty" ||
          node.type === "ClassAccessorProperty"
      ? node.key
      : node.type === "TSEnumDeclaration" || node.type === "TSEnumMember"
      ? node.id
      : node.type === "TSQualifiedName"
      ? node.right
      : undefined;

    if (node.computed === true) return;
    if (isNode(property)) fixedNames.add(property);
  };

  const markEnumLocalReferences = (node: Node): void => {
    if (node.type !== "TSEnumDeclaration") return;
    const container = isNode(node.body) ? node.body : node;
    const members = Array.isArray(container.members) ? container.members : [];
    const localNames = new Set<string>();
    const enumName = nodeName(node.id);
    if (enumName) localNames.add(enumName);
    for (const member of members) {
      if (!isNode(member)) continue;
      const memberId = isNode(member.id) ? member.id : undefined;
      const memberName = nodeName(memberId) ?? stringLiteralText(memberId);
      if (memberName) localNames.add(memberName);
    }
    for (const member of members) {
      if (!isNode(member) || !isNode(member.initializer)) continue;
      walk(member.initializer, (candidate) => {
        if (
          candidate.type === "Identifier" &&
          localNames.has(nodeName(candidate) ?? "")
        ) fixedNames.add(candidate);
      });
    }
  };

  for (const statement of body) {
    if (statement.type === "ImportDeclaration") continue;

    walk(statement, (node) => {
      if (node.type === "ImportDeclaration") return false;
      // A type position is not a runtime read. Without this the walker counts
      // `p: typeof KEY` as a use of `KEY` and keeps the server-only import it
      // came from.
      if (isErasedTypeNode(node)) return false;

      markEnumLocalReferences(node);
      markFixedName(node);

      if (node.type === "Identifier" || node.type === "JSXIdentifier") {
        if (fixedNames.has(node)) return true;
        if (excluded?.has(node)) return true;
        const name = nodeName(node);
        if (name) referenced.add(name);
      }

      return true;
    });
  }

  return referenced;
}

/** A top-level declaration and the binding names / binding-id nodes it owns. */
interface ModuleScopeDecl {
  statement: Node;
  declarator?: Node;
  names: string[];
  bindingIds: Node[];
}

interface DestructuredModuleScopeDecl {
  declarator: Node;
  bindingIds: Node[];
  analysis: BindingPatternAnalysis;
}

interface ModuleScopeDeclarationAnalysis {
  declarations: ModuleScopeDecl[];
  destructured: DestructuredModuleScopeDecl[];
}

/**
 * Non-exported top-level `const`/`let`/`var`/`function`/`class` declarations
 * whose bindings we could safely drop if nothing references them. Exported
 * declarations are part of the module's contract and are never candidates.
 * Patterns with defaults or computed keys are classified separately so an
 * unsafe hook-related declaration can fail closed. In supported patterns,
 * only binding positions are excluded from liveness analysis.
 */
function analyzeModuleScopeDeclarations(body: Node[]): ModuleScopeDeclarationAnalysis {
  const decls: ModuleScopeDecl[] = [];
  const destructured: DestructuredModuleScopeDecl[] = [];

  for (const statement of body) {
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      const id = statement.id;
      const name = nodeName(id);
      if (name && isNode(id)) decls.push({ statement, names: [name], bindingIds: [id] });
      continue;
    }

    if (
      statement.type === "TSImportEqualsDeclaration" && statement.isExport !== true &&
      !isErasedTypeNode(statement)
    ) {
      const id = statement.id;
      const name = nodeName(id);
      if (name && isNode(id)) decls.push({ statement, names: [name], bindingIds: [id] });
      continue;
    }

    if (statement.type === "VariableDeclaration") {
      const variableDecls: ModuleScopeDecl[] = [];

      for (
        const declarator of Array.isArray(statement.declarations) ? statement.declarations : []
      ) {
        if (!isNode(declarator)) continue;
        const id = declarator.id;
        if (!isNode(id)) continue;
        const analysis = analyzeBindingPattern(id);
        if (id.type !== "Identifier") {
          destructured.push({
            declarator,
            bindingIds: analysis.bindingIds,
            analysis,
          });
        }
        if (analysis.hazards.size > 0) continue;
        const bindingIds = analysis.bindingIds;
        const names = bindingIds.map(nodeName).filter((name): name is string => Boolean(name));
        if (names.length === 0 || names.length !== bindingIds.length) continue;
        variableDecls.push({ statement, declarator, names, bindingIds });
      }

      decls.push(...variableDecls);
    }
  }

  return { declarations: decls, destructured };
}

/** Whether a name is bound in the current lexical stack. */
interface LexicalScope {
  kind: "function" | "block";
  names: Set<string>;
}

function isLexicallyBound(name: string, scopes: LexicalScope[]): boolean {
  return scopes.some((scope) => scope.names.has(name));
}

/**
 * Free identifiers read by a hook body or by a declaration in the stripped
 * hook's dependency closure. Unlike `referencedIdentifiers`, this is
 * scope-aware: a nested declaration that shadows `loadJob` must not hide a
 * real outer hook read of the imported `loadJob`, and a nested local inside a
 * pruned helper must not add an unrelated import to the hook closure.
 */
function freeReferencedIdentifiers(root: Node): Set<string> {
  const free = new Set<string>();
  const rootScope: LexicalScope = { kind: "function", names: new Set() };

  const currentFunctionScope = (scopes: LexicalScope[]): LexicalScope =>
    scopes.find((scope) => scope.kind === "function") ?? scopes[0] ?? rootScope;

  const bindPatternNames = (scope: LexicalScope, value: unknown): void => {
    if (!isNode(value)) return;
    for (const name of patternBoundNames(value)) scope.names.add(name);
  };

  const bindHoistedRuntimeTsDeclaration = (scope: LexicalScope, node: Node): boolean => {
    if (
      node.type !== "TSEnumDeclaration" && node.type !== "TSModuleDeclaration" &&
      node.type !== "TSImportEqualsDeclaration"
    ) return false;
    if (!isErasedTypeNode(node)) bindPatternNames(scope, node.id);
    return true;
  };

  const bindDirectDeclarations = (scope: LexicalScope, node: Node): void => {
    const body = node.body;
    if (!Array.isArray(body)) return;

    for (const statement of body) {
      if (!isNode(statement)) continue;
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        bindPatternNames(scope, statement.id);
        continue;
      }
      if (bindHoistedRuntimeTsDeclaration(scope, statement)) continue;
      if (statement.type !== "VariableDeclaration") continue;
      for (
        const declarator of Array.isArray(statement.declarations) ? statement.declarations : []
      ) {
        if (isNode(declarator)) bindPatternNames(scope, declarator.id);
      }
    }
  };

  const bindNestedVarDeclarations = (scope: LexicalScope, node: Node): void => {
    for (const child of children(node)) {
      // Only `var` hoists. An enum, a namespace or an import-equals nested in a
      // block is block scoped (TypeScript emits `let` there), so binding it
      // into the enclosing function scope makes an unrelated outer read look
      // shadowed. `bindDirectDeclarations` already binds these at whichever
      // scope actually contains them, so they need no hoisting pass.
      if (
        child.type === "TSEnumDeclaration" || child.type === "TSImportEqualsDeclaration"
      ) continue;
      if (
        child.type === "FunctionDeclaration" || child.type === "FunctionExpression" ||
        child.type === "ArrowFunctionExpression" || child.type === "ObjectMethod" ||
        child.type === "ClassMethod" || child.type === "ClassDeclaration" ||
        child.type === "ClassExpression" || child.type === "StaticBlock" ||
        child.type === "TSModuleDeclaration"
      ) {
        continue;
      }

      if (child.type === "VariableDeclaration" && child.kind === "var") {
        for (
          const declarator of Array.isArray(child.declarations) ? child.declarations : []
        ) {
          if (isNode(declarator)) bindPatternNames(scope, declarator.id);
        }
      }
      bindNestedVarDeclarations(scope, child);
    }
  };

  const visitChildren = (node: Node, scopes: LexicalScope[]): void => {
    for (const child of referenceChildren(node)) visit(child, scopes);
  };

  const visitDecorators = (node: Node, scopes: LexicalScope[]): void => {
    for (const decorator of Array.isArray(node.decorators) ? node.decorators : []) {
      if (isNode(decorator)) visit(decorator, scopes);
    }
  };

  const visitPatternRuntime = (pattern: Node, scopes: LexicalScope[]): void => {
    if (pattern.type === "Identifier") {
      visitDecorators(pattern, scopes);
      return;
    }

    if (pattern.type === "TSParameterProperty") {
      visitDecorators(pattern, scopes);
      if (isNode(pattern.parameter)) visitPatternRuntime(pattern.parameter, scopes);
      return;
    }

    if (pattern.type === "AssignmentPattern") {
      if (isNode(pattern.left)) visitPatternRuntime(pattern.left, scopes);
      if (isNode(pattern.right)) visit(pattern.right, scopes);
      return;
    }

    if (pattern.type === "RestElement") {
      if (isNode(pattern.argument)) visitPatternRuntime(pattern.argument, scopes);
      return;
    }

    if (pattern.type === "ArrayPattern") {
      for (const element of Array.isArray(pattern.elements) ? pattern.elements : []) {
        if (isNode(element)) visitPatternRuntime(element, scopes);
      }
      return;
    }

    if (pattern.type === "ObjectPattern") {
      for (const property of Array.isArray(pattern.properties) ? pattern.properties : []) {
        if (!isNode(property)) continue;
        if (property.type === "RestElement") {
          if (isNode(property.argument)) visitPatternRuntime(property.argument, scopes);
          continue;
        }
        if (property.type !== "ObjectProperty") {
          visit(property, scopes);
          continue;
        }
        if (property.computed === true && isNode(property.key)) visit(property.key, scopes);
        if (isNode(property.value)) visitPatternRuntime(property.value, scopes);
      }
      return;
    }

    visit(pattern, scopes);
  };

  const bindVariableDeclaration = (node: Node, scopes: LexicalScope[]): void => {
    const targetScope = node.kind === "var" ? currentFunctionScope(scopes) : scopes[0] ?? rootScope;
    for (
      const declarator of Array.isArray(node.declarations) ? node.declarations : []
    ) {
      if (isNode(declarator)) bindPatternNames(targetScope, declarator.id);
    }
  };

  const visitVariableDeclaration = (node: Node, scopes: LexicalScope[]): void => {
    bindVariableDeclaration(node, scopes);
    for (
      const declarator of Array.isArray(node.declarations) ? node.declarations : []
    ) {
      if (!isNode(declarator)) continue;
      if (isNode(declarator.id)) visitPatternRuntime(declarator.id, scopes);
      if (isNode(declarator.init)) visit(declarator.init, scopes);
    }
  };

  const visitFunction = (node: Node, scopes: LexicalScope[]): void => {
    const functionScope: LexicalScope = { kind: "function", names: new Set() };
    if (node.type === "FunctionDeclaration") bindPatternNames(scopes[0] ?? rootScope, node.id);
    bindPatternNames(functionScope, node.id);

    for (const param of Array.isArray(node.params) ? node.params : []) {
      if (isNode(param)) bindPatternNames(functionScope, param);
    }
    for (const param of Array.isArray(node.params) ? node.params : []) {
      if (isNode(param)) visitPatternRuntime(param, [functionScope, ...scopes]);
    }

    bindDirectDeclarations(functionScope, isNode(node.body) ? node.body : node);
    if (isNode(node.body)) bindNestedVarDeclarations(functionScope, node.body);

    const body = node.body;
    if (isNode(body)) {
      if (Array.isArray(body.body)) {
        for (const statement of body.body) {
          if (isNode(statement)) visit(statement, [functionScope, ...scopes]);
        }
      } else {
        visit(body, [functionScope, ...scopes]);
      }
    }
  };

  const visitObjectMember = (node: Node, scopes: LexicalScope[]): void => {
    visitDecorators(node, scopes);
    if (node.computed === true && isNode(node.key)) visit(node.key, scopes);
    if (isNode(node.value)) visit(node.value, scopes);
  };

  const visitFor = (node: Node, scopes: LexicalScope[]): void => {
    const loopScope: LexicalScope = { kind: "block", names: new Set() };
    const scoped = [loopScope, ...scopes];

    const init = node.init ?? node.left;
    if (isNode(init) && init.type === "VariableDeclaration") visitVariableDeclaration(init, scoped);
    else if (isNode(init)) visit(init, scopes);

    for (const key of ["test", "update", "right"] as const) {
      const value = node[key];
      if (isNode(value)) visit(value, scoped);
    }
    if (isNode(node.body)) visit(node.body, scoped);
  };

  const visitSwitch = (node: Node, scopes: LexicalScope[]): void => {
    if (isNode(node.discriminant)) visit(node.discriminant, scopes);

    const switchScope: LexicalScope = { kind: "block", names: new Set() };
    const scoped = [switchScope, ...scopes];

    for (const caseNode of Array.isArray(node.cases) ? node.cases : []) {
      if (!isNode(caseNode)) continue;
      if (isNode(caseNode.test)) visit(caseNode.test, scopes);
      for (const statement of Array.isArray(caseNode.consequent) ? caseNode.consequent : []) {
        if (isNode(statement)) visit(statement, scoped);
      }
    }
  };

  const visit = (node: Node, scopes: LexicalScope[]): void => {
    if (node.type === "ImportDeclaration") return;
    // Same classification `referencedIdentifiers` uses. A value-emitting
    // TypeScript node such as an enum or a namespace body falls through to the
    // generic walk below, and its erased type operand is skipped there in turn.
    if (isErasedTypeNode(node)) return;

    if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      const name = nodeName(node);
      if (name && !isLexicallyBound(name, scopes)) free.add(name);
      return;
    }

    if (
      node.type === "Program" || node.type === "BlockStatement" ||
      node.type === "TSModuleBlock"
    ) {
      const scope: LexicalScope = { kind: "block", names: new Set() };
      bindDirectDeclarations(scope, node);
      for (const statement of Array.isArray(node.body) ? node.body : []) {
        if (isNode(statement)) visit(statement, [scope, ...scopes]);
      }
      return;
    }

    if (node.type === "StaticBlock") {
      // A static block is its own var and lexical scope. Without this, a local
      // declaration can bind the surrounding program scope and hide a later
      // read of an imported binding with the same name.
      const staticScope: LexicalScope = { kind: "function", names: new Set() };
      bindDirectDeclarations(staticScope, node);
      bindNestedVarDeclarations(staticScope, node);
      for (const statement of Array.isArray(node.body) ? node.body : []) {
        if (isNode(statement)) visit(statement, [staticScope, ...scopes]);
      }
      return;
    }

    if (node.type === "VariableDeclaration") {
      visitVariableDeclaration(node, scopes);
      return;
    }

    if (
      node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      visitFunction(node, scopes);
      return;
    }

    // A runtime TypeScript declaration binds its own name and, for an enum,
    // names its members. Only the initialisers read anything, so descending
    // blindly would report `enum Level { Low }` as a read of an unrelated
    // module-scope `Low` and let the pass delete it.
    if (node.type === "TSEnumDeclaration") {
      bindPatternNames(scopes[0] ?? rootScope, node.id);
      const container = isNode(node.body) ? node.body : node;
      const members = Array.isArray(container.members) ? container.members : [];
      // Member initialisers can name a preceding member without qualifying it,
      // as in `enum Access { Read = 1, Both = Read }`. Those names resolve to
      // the enum, not to module scope, so bind them in their own scope first:
      // otherwise `Read` reads as free and the pass pulls an unrelated
      // module-scope `Read` into the hook closure and deletes it.
      const scope: LexicalScope = { kind: "block", names: new Set() };
      for (const member of members) {
        if (!isNode(member)) continue;
        const memberId = isNode(member.id) ? member.id : undefined;
        const memberName = nodeName(memberId) ?? stringLiteralText(memberId);
        if (memberName) scope.names.add(memberName);
      }
      for (const member of members) {
        if (isNode(member) && isNode(member.initializer)) {
          visit(member.initializer, [scope, ...scopes]);
        }
      }
      return;
    }

    if (node.type === "TSModuleDeclaration") {
      bindPatternNames(scopes[0] ?? rootScope, node.id);
      // Every emitted namespace IIFE introduces its own binding scope. For a
      // dotted declaration such as `namespace A.B`, B belongs to A's scope,
      // not to the surrounding module.
      const namespaceScope: LexicalScope = { kind: "function", names: new Set() };
      bindPatternNames(namespaceScope, node.id);
      if (isNode(node.body)) {
        if (node.body.type === "TSModuleBlock") {
          bindNestedVarDeclarations(namespaceScope, node.body);
        }
        visit(node.body, [namespaceScope, ...scopes]);
      }
      return;
    }

    if (node.type === "TSImportEqualsDeclaration") {
      bindPatternNames(scopes[0] ?? rootScope, node.id);
      if (isNode(node.moduleReference)) visit(node.moduleReference, scopes);
      return;
    }

    // `import Alias = NS.Sub`: only `NS` is a read, `Sub` is a fixed name.
    if (node.type === "TSQualifiedName") {
      if (isNode(node.left)) visit(node.left, scopes);
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.type === "ClassDeclaration") bindPatternNames(scopes[0] ?? rootScope, node.id);
      visitDecorators(node, scopes);
      if (isNode(node.superClass)) visit(node.superClass, scopes);
      const classScope: LexicalScope = { kind: "block", names: new Set() };
      bindPatternNames(classScope, node.id);
      const body = node.body;
      if (isNode(body)) visitChildren(body, [classScope, ...scopes]);
      return;
    }

    if (node.type === "CatchClause") {
      const scope: LexicalScope = { kind: "block", names: new Set() };
      if (isNode(node.param)) {
        visitPatternRuntime(node.param, [scope, ...scopes]);
        bindPatternNames(scope, node.param);
      }
      if (isNode(node.body)) visit(node.body, [scope, ...scopes]);
      return;
    }

    if (
      node.type === "ForStatement" || node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      visitFor(node, scopes);
      return;
    }

    if (node.type === "SwitchStatement") {
      visitSwitch(node, scopes);
      return;
    }

    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      if (isNode(node.object)) visit(node.object, scopes);
      if (node.computed === true && isNode(node.property)) visit(node.property, scopes);
      return;
    }

    if (
      node.type === "ObjectProperty" || node.type === "ClassProperty" ||
      node.type === "ClassAccessorProperty"
    ) {
      visitObjectMember(node, scopes);
      return;
    }

    if (node.type === "ObjectMethod" || node.type === "ClassMethod") {
      visitDecorators(node, scopes);
      if (node.computed === true && isNode(node.key)) visit(node.key, scopes);
      visitFunction(node, scopes);
      return;
    }

    visitChildren(node, scopes);
  };

  bindDirectDeclarations(rootScope, root);
  visit(root, [rootScope]);
  return free;
}

/**
 * Identifiers referenced inside the server-only hooks that are about to be
 * emptied. It is the seed of the hook's dependency closure. Must be collected before
 * the hook bodies are replaced with stubs. `targets` is the set of local hook
 * names (as passed to `emptyServerOnlyHooks`).
 */
function hookReferencedIdentifiers(body: Node[], targets: Set<string>): Set<string> {
  const declarationsIn = (statement: Node): Node[] => {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    return isNode(declaration) ? [declaration] : [];
  };

  const referenced = new Set<string>();
  const collect = (node: Node): void => {
    for (const name of freeReferencedIdentifiers(node)) referenced.add(name);
  };

  for (const statement of body) {
    for (const declaration of declarationsIn(statement)) {
      if (declaration.type === "FunctionDeclaration") {
        const name = nodeName(declaration.id);
        if (name && targets.has(name)) collect(declaration);
        continue;
      }
      if (declaration.type !== "VariableDeclaration") continue;
      for (
        const declarator of Array.isArray(declaration.declarations) ? declaration.declarations : []
      ) {
        if (!isNode(declarator)) continue;
        const name = nodeName(declarator.id);
        if (name && targets.has(name) && isNode(declarator.init)) collect(declarator.init);
      }
    }
  }

  return referenced;
}

/**
 * Both reference walkers' answers for one parsed module.
 *
 * `referenced` is the flat over-approximation that decides whether a
 * declaration or an import binding is still live. `free` is the scope-aware
 * walk that seeds and grows the stripped hooks' dependency closure. The two
 * must classify TypeScript syntax identically: if one counts a type-position
 * read as a runtime reference and the other does not, a hook-only import stays
 * in the browser artifact, and if one skips a value-emitting TypeScript node
 * the pass deletes live code.
 *
 * Exported so that agreement can be tested directly. It is not observable
 * through `stripServerOnlyExports` on compiled input, because the compile stage
 * erases every TypeScript node before this stage runs today.
 */
export function moduleReferenceWalkers(ast: ASTNode): {
  referenced: Set<string>;
  free: Set<string>;
} {
  const program = (ast as { program?: unknown }).program;
  const root: Node = isNode(program) ? program : ast;
  return {
    referenced: referencedIdentifiers(bodyOf(ast)),
    free: freeReferencedIdentifiers(root),
  };
}

function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  return typeof node.value === "string" ? node.value : nodeName(node);
}

function stringLiteralText(node: Node | undefined): string | null {
  return node && typeof node.value === "string" ? node.value : null;
}

function isObjectDefineProperty(node: Node | undefined): boolean {
  if (!node || node.type !== "MemberExpression") return false;
  return nodeName(node.object) === "Object" &&
    literalText(isNode(node.property) ? node.property : undefined) === "defineProperty";
}

function returnedCall(node: Node): Node | null {
  const body = node.body;
  if (!isNode(body)) return null;
  if (body.type === "CallExpression") return body;
  if (body.type !== "BlockStatement" || !Array.isArray(body.body) || body.body.length !== 1) {
    return null;
  }

  const statement = body.body[0];
  if (!isNode(statement) || statement.type !== "ReturnStatement" || !isNode(statement.argument)) {
    return null;
  }
  return statement.argument.type === "CallExpression" ? statement.argument : null;
}

function isTrueExpression(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.value === true) return true;
  return node.type === "UnaryExpression" && node.operator === "!" &&
    isNode(node.argument) && node.argument.value === 0;
}

function isNameDescriptor(node: Node | undefined, valueParam: string): boolean {
  if (!node || node.type !== "ObjectExpression") return false;

  let hasValue = false;
  let configurable = false;
  for (const property of Array.isArray(node.properties) ? node.properties : []) {
    if (!isNode(property) || property.type !== "ObjectProperty") continue;
    const key = literalText(isNode(property.key) ? property.key : undefined);
    const value = isNode(property.value) ? property.value : undefined;
    if (key === "value" && nodeName(value) === valueParam) hasValue = true;
    if (key === "configurable" && isTrueExpression(value)) configurable = true;
  }

  return hasValue && configurable;
}

/**
 * Bindings for esbuild's `keepNames` helper. Release modules are compiled
 * before the browser transform, so their declarations are followed by calls
 * like `__name(loadPage, "loadPage")`. Recognise the helper by its exact
 * `Object.defineProperty(target, "name", …)` semantics rather than by its
 * minified binding name.
 */
function moduleBindingInitializers(body: Node[]): Map<string, Node[]> {
  const initializers = new Map<string, Node[]>();
  for (const statement of body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of Array.isArray(statement.declarations) ? statement.declarations : []) {
      if (!isNode(declarator) || !isNode(declarator.init)) continue;
      const name = nodeName(declarator.id);
      if (!name) continue;
      const existing = initializers.get(name);
      if (existing) existing.push(declarator.init);
      else initializers.set(name, [declarator.init]);
    }
  }
  return initializers;
}

function definePropertyHelperBindings(initializers: Map<string, Node[]>): Set<string> {
  const bindings = new Set<string>();
  for (const [name, inits] of initializers) {
    if (inits.length === 1 && inits.some(isObjectDefineProperty)) bindings.add(name);
  }
  return bindings;
}

function duplicateDefinePropertyHelperBindings(initializers: Map<string, Node[]>): Set<string> {
  const bindings = new Set<string>();
  for (const [name, inits] of initializers) {
    if (inits.length > 1 && inits.some(isObjectDefineProperty)) bindings.add(name);
  }
  return bindings;
}

interface CompilerNameHelperShape {
  definePropertyBinding: string | null;
}

function compilerNameHelperShape(init: Node): CompilerNameHelperShape | null {
  if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") return null;
  const params = Array.isArray(init.params) ? init.params.filter(isNode) : [];
  if (params.length !== 2) return null;
  const targetParam = nodeName(params[0]);
  const valueParam = nodeName(params[1]);
  if (!targetParam || !valueParam) return null;

  const call = returnedCall(init);
  if (!call) return null;
  const callee = isNode(call.callee) ? call.callee : undefined;
  let definePropertyBinding: string | null;
  if (isObjectDefineProperty(callee)) {
    definePropertyBinding = null;
  } else {
    if (callee?.type !== "Identifier") return null;
    const binding = nodeName(callee);
    if (!binding) return null;
    definePropertyBinding = binding;
  }

  const args = Array.isArray(call.arguments) ? call.arguments.filter(isNode) : [];
  if (
    args.length !== 3 || nodeName(args[0]) !== targetParam ||
    stringLiteralText(args[1]) !== "name" || !isNameDescriptor(args[2], valueParam)
  ) {
    return null;
  }
  return { definePropertyBinding };
}

function isCompilerNameHelperInitializer(
  init: Node,
  definePropertyBindings: Set<string>,
): boolean {
  const shape = compilerNameHelperShape(init);
  return shape !== null &&
    (shape.definePropertyBinding === null ||
      definePropertyBindings.has(shape.definePropertyBinding));
}

function compilerNameHelperBindings(body: Node[]): Set<string> {
  const initializers = moduleBindingInitializers(body);
  const definePropertyBindings = definePropertyHelperBindings(initializers);

  const helpers = new Set<string>();
  for (const [name, inits] of initializers) {
    if (inits.some((init) => isCompilerNameHelperInitializer(init, definePropertyBindings))) {
      helpers.add(name);
    }
  }

  return helpers;
}

function duplicateCompilerNameHelperBindings(body: Node[]): Set<string> {
  const initializers = moduleBindingInitializers(body);
  const definePropertyBindings = definePropertyHelperBindings(initializers);
  const duplicates = new Set<string>();
  for (const [name, inits] of initializers) {
    if (
      inits.length > 1 &&
      inits.some((init) => isCompilerNameHelperInitializer(init, definePropertyBindings))
    ) {
      duplicates.add(name);
    }
  }
  return duplicates;
}

function compilerNameHelpersWithDuplicateDefinePropertyAliases(body: Node[]): Map<string, string> {
  const initializers = moduleBindingInitializers(body);
  const duplicateAliases = duplicateDefinePropertyHelperBindings(initializers);
  const helpers = new Map<string, string>();
  for (const [name, inits] of initializers) {
    for (const init of inits) {
      const alias = compilerNameHelperShape(init)?.definePropertyBinding;
      if (alias && duplicateAliases.has(alias)) helpers.set(name, alias);
    }
  }
  return helpers;
}

function failOnAmbiguousCompilerNameHelperDuplicates(
  body: Node[],
  hookClosure: Set<string>,
  filePath: string | undefined,
): void {
  const duplicates = duplicateCompilerNameHelperBindings(body);
  const duplicateAliases = compilerNameHelpersWithDuplicateDefinePropertyAliases(body);
  if (duplicates.size === 0 && duplicateAliases.size === 0) return;

  const candidates: Array<{
    target: Node;
    targetName: string;
    reason: string;
  }> = [];
  for (const statement of body) {
    if (statement.type !== "ExpressionStatement" || !isNode(statement.expression)) continue;
    const expression = statement.expression;
    if (expression.type !== "CallExpression" || !isNode(expression.callee)) continue;
    const calleeName = nodeName(expression.callee);
    if (!calleeName) continue;
    const duplicateAlias = duplicateAliases.get(calleeName);
    if (!duplicates.has(calleeName) && duplicateAlias === undefined) continue;

    const args = Array.isArray(expression.arguments) ? expression.arguments.filter(isNode) : [];
    const target = args[0];
    const targetName = nodeName(target);
    if (!target || args.length !== 2 || !targetName || stringLiteralText(args[1]) === null) {
      continue;
    }
    const reason = duplicateAlias === undefined
      ? `compiler name helper \`${calleeName}\` is declared more than once`
      : `compiler name helper \`${calleeName}\` uses defineProperty alias \`${duplicateAlias}\` declared more than once`;
    candidates.push({ target, targetName, reason });
  }
  if (candidates.length === 0) return;

  const excluded = new WeakSet<Node>();
  const scopeDeclarations = analyzeModuleScopeDeclarations(body);
  for (const decl of scopeDeclarations.declarations) {
    for (const id of decl.bindingIds) excluded.add(id);
  }
  for (const decl of scopeDeclarations.destructured) {
    for (const id of decl.bindingIds) excluded.add(id);
  }
  for (const registration of compilerNameRegistrations(body)) excluded.add(registration.target);
  for (const candidate of candidates) excluded.add(candidate.target);
  const referenced = referencedIdentifiers(body, excluded);

  for (const candidate of candidates) {
    if (hookClosure.has(candidate.targetName) && !referenced.has(candidate.targetName)) {
      throw new ServerExportStripError(
        filePath,
        candidate.reason,
      );
    }
  }
}

interface CompilerNameRegistration {
  statement: Node;
  target: Node;
  targetName: string;
}

function compilerNameRegistrations(body: Node[]): CompilerNameRegistration[] {
  const helpers = compilerNameHelperBindings(body);
  if (helpers.size === 0) return [];

  const registrations: CompilerNameRegistration[] = [];
  for (const statement of body) {
    if (statement.type !== "ExpressionStatement" || !isNode(statement.expression)) continue;
    const expression = statement.expression;
    if (expression.type !== "CallExpression" || !isNode(expression.callee)) continue;
    if (!helpers.has(nodeName(expression.callee) ?? "")) continue;

    const args = Array.isArray(expression.arguments) ? expression.arguments.filter(isNode) : [];
    const target = args[0];
    const targetName = nodeName(target);
    if (!target || args.length !== 2 || !targetName || stringLiteralText(args[1]) === null) {
      continue;
    }
    registrations.push({ statement, target, targetName });
  }

  return registrations;
}

const JSX_PRAGMA_RUNTIME = /@jsxRuntime\s+(\S+)/;
const JSX_PRAGMA_FACTORY = /@jsx\s+(\S+)/;
const JSX_PRAGMA_FRAGMENT = /@jsxFrag\s+(\S+)/;
const DEFAULT_CLASSIC_FACTORY_ROOT = "React";

function pragmaRootBinding(expression: string | undefined): string | null {
  const root = expression?.split(/[.([]/)[0]?.trim();
  return root && isEcmaScriptIdentifier(root) ? root : null;
}

function jsxPragmaBindings(ast: ASTNode): Set<string> {
  const pinned = new Set<string>();
  const comments = (ast as { comments?: unknown }).comments;
  if (!Array.isArray(comments)) return pinned;

  const texts: string[] = [];
  for (const comment of comments) {
    const text = isNode(comment) ? comment.value : undefined;
    if (typeof text === "string" && text.includes("@jsx")) texts.push(text);
  }
  if (!texts.some((text) => JSX_PRAGMA_RUNTIME.exec(text)?.[1] === "classic")) return pinned;

  for (const text of texts) {
    for (const pattern of [JSX_PRAGMA_FACTORY, JSX_PRAGMA_FRAGMENT]) {
      const root = pragmaRootBinding(pattern.exec(text)?.[1]);
      if (root) pinned.add(root);
    }
  }
  pinned.add(DEFAULT_CLASSIC_FACTORY_ROOT);
  return pinned;
}

function isBrowserDroppableImportSource(source: unknown): source is string {
  return typeof source === "string" &&
    (source.startsWith("node:") || source === "veryfront" || source.startsWith("veryfront/"));
}

function knownServerImportBindings(body: Node[]): Set<string> {
  const bindings = new Set<string>();
  for (const statement of body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const source = isNode(statement.source) ? statement.source.value : undefined;
    if (!isBrowserDroppableImportSource(source)) continue;
    for (const binding of importedBindings(statement)) bindings.add(binding);
  }
  return bindings;
}

function staticCalleeRoot(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return nodeName(node);
  if (
    (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
    node.computed !== true && isNode(node.object)
  ) {
    return staticCalleeRoot(node.object);
  }
  return null;
}

/** A deliberately small data-only subset, not a general purity analysis. */
function isStaticInitializerArgument(node: Node): boolean {
  if (node.type === "TemplateLiteral") {
    return !Array.isArray(node.expressions) || node.expressions.length === 0;
  }
  return node.type === "Literal" || node.type.endsWith("Literal");
}

function isKnownServerInitializer(node: Node | undefined, trustedBindings: Set<string>): boolean {
  if (!node) return false;
  if (node.type === "Identifier") return trustedBindings.has(nodeName(node) ?? "");
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const root = staticCalleeRoot(node);
    return root !== null && trustedBindings.has(root);
  }
  if (node.type !== "CallExpression") return false;
  const root = staticCalleeRoot(isNode(node.callee) ? node.callee : undefined);
  if (root === null || !trustedBindings.has(root)) return false;
  return (Array.isArray(node.arguments) ? node.arguments : []).every((argument) =>
    isNode(argument) && isStaticInitializerArgument(argument)
  );
}

type DestructuringDisposition =
  | "keep-client-live"
  | "not-hook-related"
  | "reject-initializer"
  | "reject-pattern"
  | "remove";

interface DestructuringDecisionInput {
  analysis: BindingPatternAnalysis;
  clientReferences: Set<string>;
  hookClosure: Set<string>;
  initializerIsKnownServer: boolean;
  pinned: Set<string>;
}

function decideDestructuringDisposition(
  input: DestructuringDecisionInput,
): DestructuringDisposition {
  const { analysis, clientReferences, hookClosure, initializerIsKnownServer, pinned } = input;
  if (!analysis.possibleNames.some((name) => hookClosure.has(name))) return "not-hook-related";
  if (analysis.hazards.has("unknown-syntax")) return "reject-pattern";

  const names = analysis.bindingIds.map(nodeName).filter((name): name is string => Boolean(name));
  if (names.some((name) => clientReferences.has(name) || pinned.has(name))) {
    return "keep-client-live";
  }
  if (analysis.hazards.size > 0) return "reject-pattern";
  if (names.length > 0 && names.every((name) => hookClosure.has(name))) return "remove";
  return initializerIsKnownServer ? "remove" : "reject-initializer";
}

function throwUnsafeServerDestructuring(disposition: DestructuringDisposition): never {
  const reason = disposition === "reject-pattern"
    ? "the binding pattern evaluates a default value, a computed key, or unsupported syntax"
    : "the initializer or one of its arguments may run unproven client side effects";
  throw SERVER_ONLY_IN_CLIENT.create({
    message:
      `Cannot safely remove module-scope destructuring used by a server-only hook because ${reason}. ` +
      "Move the destructuring into getServerData or the server-only hook that uses it. " +
      "Declare client initialization separately.\n\n" +
      'import { getEnv } from "veryfront";\n\n' +
      "export async function getServerData() {\n" +
      '  const { serverValue } = getEnv("<KEY>");\n' +
      "  return { props: { serverValue } };\n" +
      "}\n\n" +
      'const clientValue = "<CLIENT_VALUE>";\n\n' +
      "export default function Page() {\n" +
      "  return clientValue;\n" +
      "}",
    detail: "Ambiguous module-scope destructuring crosses the server and browser boundary",
    context: { reason: disposition },
  });
}

/** @internal Stable test seams for the browser server-export safety policy. */
export const browserServerExportsStripInternals = Object.freeze({
  analyzeBindingPattern(value: unknown) {
    const analysis = analyzeBindingPattern(value);
    return {
      bindingNames: analysis.bindingIds.map(nodeName).filter(
        (name): name is string => Boolean(name),
      ),
      possibleNames: [...analysis.possibleNames],
      hazards: [...analysis.hazards].sort(),
    };
  },
});

/**
 * Drop the top-level declarations the emptied server-only hooks closed over.
 *
 * Scope is the *dependency closure of the stripped hooks*, not "everything
 * unreferenced". A declaration is removed only when (a) it is reached from the
 * hook's own reference graph, seeded from `hookClosure` and grown through the
 * initialisers of declarations already removed, and (b) nothing surviving in
 * the module still references it. So `const API_KEY = getEnv(...)` read only by
 * `getServerData` goes (letting `dropUnusedImportBindings` drop the import
 * next), while an unrelated `const _ = bootClientAnalytics()`, never part of
 * the hook graph, is left intact along with its side effect. Iterates to a
 * fixpoint: removing one binding can leave a helper it was the last user of
 * newly dead *within the closure*.
 */
function dropUnusedModuleScopeBindings(
  body: Node[],
  hookClosure: Set<string>,
  filePath: string | undefined,
  pinned: Set<string>,
): Node[] {
  let current = body;

  for (;;) {
    const { declarations: decls, destructured } = analyzeModuleScopeDeclarations(current);
    if (decls.length === 0 && destructured.length === 0) return current;
    failOnAmbiguousCompilerNameHelperDuplicates(current, hookClosure, filePath);

    const excluded = new WeakSet<Node>();
    for (const decl of decls) for (const id of decl.bindingIds) excluded.add(id);
    for (const decl of destructured) for (const id of decl.bindingIds) excluded.add(id);

    // Esbuild's generated name-registration call is metadata for a declaration,
    // not an independent browser consumer of it. Ignore that target reference
    // when deciding liveness, and remove the call together with a declaration
    // that proves hook-only.
    const nameRegistrations = compilerNameRegistrations(current);
    for (const registration of nameRegistrations) excluded.add(registration.target);

    const referenced = referencedIdentifiers(current, excluded);
    const trustedBindings = knownServerImportBindings(current);
    const destructuringDecisions = new Map<Node, DestructuringDisposition>();
    for (const decl of destructured) {
      const disposition = decideDestructuringDisposition({
        analysis: decl.analysis,
        clientReferences: referenced,
        hookClosure,
        initializerIsKnownServer: isKnownServerInitializer(
          isNode(decl.declarator.init) ? decl.declarator.init : undefined,
          trustedBindings,
        ),
        pinned,
      });
      if (disposition === "reject-initializer" || disposition === "reject-pattern") {
        throwUnsafeServerDestructuring(disposition);
      }
      destructuringDecisions.set(decl.declarator, disposition);
    }

    const removableStatements = new Set<Node>();
    const removableDeclarators = new Map<Node, Set<Node>>();
    const removedDecls: ModuleScopeDecl[] = [];
    for (const decl of decls) {
      const destructuringDecision = decl.declarator === undefined
        ? undefined
        : destructuringDecisions.get(decl.declarator);
      const inClosure = destructuringDecision === undefined
        ? decl.names.every((name) => hookClosure.has(name))
        : destructuringDecision === "remove";
      const unused = decl.names.every((name) => !referenced.has(name) && !pinned.has(name));
      if (!inClosure || !unused) continue;

      removedDecls.push(decl);
      for (const registration of nameRegistrations) {
        if (decl.names.includes(registration.targetName)) {
          removableStatements.add(registration.statement);
        }
      }
      if (!decl.declarator) {
        removableStatements.add(decl.statement);
        continue;
      }

      const statementDeclarators = Array.isArray(decl.statement.declarations)
        ? decl.statement.declarations.filter(isNode)
        : [];
      let statementRemoval = removableDeclarators.get(decl.statement);
      if (!statementRemoval) {
        statementRemoval = new Set();
        removableDeclarators.set(decl.statement, statementRemoval);
      }
      statementRemoval.add(decl.declarator);

      if (
        statementDeclarators.length > 0 &&
        statementDeclarators.every((declarator) => statementRemoval?.has(declarator))
      ) {
        removableStatements.add(decl.statement);
        removableDeclarators.delete(decl.statement);
      }
    }
    if (removedDecls.length === 0) return current;

    // Grow the closure through the removed declarations' initialisers, so a
    // chain that only fed the hook (`const RAW = getEnv(); const TOKEN = RAW…`)
    // is pruned end to end while unrelated declarations stay outside it.
    for (const decl of removedDecls) {
      for (const name of freeReferencedIdentifiers(decl.declarator ?? decl.statement)) {
        hookClosure.add(name);
      }
    }

    for (const [statement, declarators] of removableDeclarators) {
      const declarations = statement.declarations;
      if (!Array.isArray(declarations)) continue;
      statement.declarations = declarations.filter((declarator) => {
        return !isNode(declarator) || !declarators.has(declarator);
      });
    }

    current = current.filter((statement) => !removableStatements.has(statement));
  }
}

/** Local binding names an import statement introduces. */
function importedBindings(statement: Node): string[] {
  const bindings: string[] = [];

  for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
    if (!isNode(specifier)) continue;
    // `import { hashOf, type Cfg }`: `Cfg` is erased before the module runs, so
    // it is not a binding that has to be kept alive. Counting it would stop
    // `hashOf` alone from proving the import hook-only, and the statement would
    // be reduced to a side-effect import instead of deleted.
    if (specifier.importKind === "type") continue;
    const name = nodeName(specifier.local);
    if (name) bindings.push(name);
  }

  return bindings;
}

/**
 * Drop imports nothing references any more when their bindings are in the
 * stripped hook's dependency closure, or when their source is known unsafe or
 * unnecessary as a browser side-effect import. Keeping a hook-only import as a
 * bare side-effect import would keep its transitive graph in the browser
 * artifact, which is exactly what this stage strips. Other unused imports keep
 * the legacy conservative side-effect rewrite.
 */
function dropUnusedImportBindings(
  body: Node[],
  hookClosure: Set<string>,
  pinned: Set<string>,
  options: StripServerOnlyExportsOptions,
): Node[] {
  // Import liveness must be scope-aware. A local enum member, namespace,
  // parameter property, or ordinary nested binding can share a spelling with
  // an import without reading that imported binding.
  const referenced = freeReferencedIdentifiers({ type: "Program", body });

  return body.filter((statement) => {
    if (statement.type !== "ImportDeclaration") return true;
    if (statement.importKind === "type") return true;

    const bindings = importedBindings(statement);
    // Already a side-effect import: nothing to drop.
    if (bindings.length === 0) return true;
    if (bindings.some((binding) => referenced.has(binding) || pinned.has(binding))) return true;

    const source = isNode(statement.source) ? statement.source.value : undefined;
    const isKnownDroppableSource = isBrowserDroppableImportSource(source);
    // A node: or veryfront source is unsafe or pointless as a browser
    // side-effect import whatever used it. Any other source is deleted when the
    // stripped hook owned at least one binding and no surviving code reads any
    // binding it declares. Keeping the rest of that statement would keep the
    // imported module's transitive graph in the browser artifact, especially
    // under JS/JSX loaders where compile cannot erase unused named imports.
    if (isKnownDroppableSource || bindings.some((binding) => hookClosure.has(binding))) {
      return false;
    }

    if (options.preserveUnownedUnusedImports === true) {
      // The browser strip runs before compile. For TS and TSX, esbuild can
      // erase genuinely unused named imports after this stage. Rewriting them
      // to bare side-effect imports here would make erasable imports
      // non-erasable.
      return true;
    }

    // Direct helper callers and non-TypeScript browser inputs keep the legacy
    // conservative behavior: leave the module evaluation but remove the
    // binding. JS, JSX, and generated MDX compile output do not get unused
    // import erasure from esbuild transform mode.
    statement.specifiers = [];
    return true;
  });
}

function retainLeadingComments(before: Node[], after: Node[]): Node[] {
  const kept = new Set<Node>(after);
  let orphaned: unknown[] = [];
  let lastKept: Node | undefined;

  for (const statement of before) {
    if (!kept.has(statement)) {
      const comments = statement.leadingComments;
      if (Array.isArray(comments)) orphaned = [...orphaned, ...comments];
      continue;
    }

    lastKept = statement;
    if (orphaned.length === 0) continue;
    const existing = Array.isArray(statement.leadingComments) ? statement.leadingComments : [];
    statement.leadingComments = [
      ...orphaned,
      ...existing.filter((comment) => !orphaned.includes(comment)),
    ];
    orphaned = [];
  }

  if (orphaned.length > 0 && lastKept !== undefined) {
    const existing = Array.isArray(lastKept.trailingComments) ? lastKept.trailingComments : [];
    lastKept.trailingComments = [
      ...existing.filter((comment) => !orphaned.includes(comment)),
      ...orphaned,
    ];
  }

  return after;
}

function setBody(ast: ASTNode, body: Node[]): void {
  const program = (ast as { program?: unknown }).program;
  const target: Node = isNode(program) ? program : ast;
  target.body = body;
}

/**
 * Raised when a module names a server-only export that this pass cannot remove.
 * Emitting the module anyway would put the loader, its imports and anything it
 * closes over into the browser bundle, so the build stops instead.
 */
class ServerExportStripError extends Error {
  constructor(filePath: string | undefined, reason: string) {
    super(
      `Cannot remove the server-only export from ${filePath ?? "this module"} ` +
        `before it is sent to the browser: ${reason}. ` +
        `Declare the hook directly (\`export async function getServerData() {…}\`) ` +
        `so the framework can strip it from the client build.`,
    );
    this.name = "ServerExportStripError";
  }
}

/**
 * Empty the server-only hooks in `code` and drop the import bindings they were
 * the last user of. Returns `code` unchanged when there is nothing to strip.
 *
 * Throws when the module names a server-only export and this pass cannot act on
 * it: no parser registered, the module does not parse, or the hook is exported
 * in a form with no local declaration to empty. Failing the build is the only
 * safe outcome. The alternative is shipping the loader to the browser.
 */
export async function stripServerOnlyExports(
  code: string,
  filePath?: string,
  options: StripServerOnlyExportsOptions = {},
): Promise<string> {
  // Cheap pre-check: no plausible exported hook shape means no parse. Escaped
  // export names require parsing because the runtime sees the normalized name.
  if (!mayNameServerOnlyExport(code)) return code;

  const parser = tryResolve<CodeParser>("CodeParser");
  if (!parser) {
    throw new ServerExportStripError(filePath, "no CodeParser extension is registered");
  }

  let body: Node[];
  let ast: ASTNode;
  let stubs: { body: Node; init: Node };

  try {
    const parsedStubs = await parseStubs(parser);
    if (!parsedStubs) throw new Error("the stub source did not parse");
    stubs = parsedStubs;
  } catch (error) {
    throw new ServerExportStripError(filePath, errorMessage(error));
  }

  try {
    ast = await parser.parse({ code, filePath: filePath ?? "module.tsx" });
    body = bodyOf(ast);
  } catch (error) {
    if (options.classifySourceParseErrors === true && isParserSourceDiagnostic(error)) {
      getErrorCollector().addCompileError(errorMessage(error), filePath);
      throw createSourceParseCompilationError(filePath, error);
    }
    throw new ServerExportStripError(filePath, errorMessage(error));
  }

  const { locals, unhandled } = exportedHookBindings(body);
  if (unhandled.length > 0) {
    throw new ServerExportStripError(filePath, `it is exported as \`${unhandled[0]}\``);
  }

  // Capture what the hooks reference *before* emptying them, so pruning is
  // scoped to the hooks' dependency closure and never touches unrelated
  // top-level declarations (which may run browser side effects).
  const hookClosure = hookReferencedIdentifiers(body, locals);

  if (!emptyServerOnlyHooks(body, locals, stubs)) return code;

  // Drop the module-scope state the emptied hooks were the last user of, then
  // the imports that leaves unused. Order matters: pruning `const API_KEY =
  // getEnv(...)` is what makes the `veryfront` import droppable.
  //
  // Ordering dependency: this pass runs before compile. Browser TS and TSX
  // inputs can leave unowned unused named imports authored so compile can erase
  // them. Moving this pass back after compile must restore a later
  // unused-import erasure step or revisit that policy.
  const pinned = jsxPragmaBindings(ast);
  const pruned = retainLeadingComments(
    body,
    dropUnusedModuleScopeBindings(body, hookClosure, filePath, pinned),
  );
  setBody(
    ast,
    retainLeadingComments(pruned, dropUnusedImportBindings(pruned, hookClosure, pinned, options)),
  );

  const generated = await parser.generate(ast);
  return dropSourceMapSuffix(generated.code);
}

export const browserServerExportsStripPlugin: TransformPlugin = {
  name: "browser-server-exports-strip",
  // After parse and before compile, so stripped hook bodies never reach
  // esbuild keepNames or the compile sourcemap. The array order in
  // BROWSER_PIPELINE must agree with this stage number because custom plugins
  // cause the pipeline to be sorted by stage.
  stage: TransformStage.PARSE + 0.5,
  condition: (ctx: TransformContext) => ctx.target === "browser",
  transform: (ctx: TransformContext) =>
    stripServerOnlyExports(ctx.code, ctx.filePath, {
      classifySourceParseErrors: true,
      preserveUnownedUnusedImports: isTypeScript(ctx),
    }),
};
