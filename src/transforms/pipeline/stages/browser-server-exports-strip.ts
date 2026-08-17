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
 * used only by a server-only hook that this pass just emptied. Nor can its
 * tree-shaker own the rest of the job (verified against esbuild 0.28.1, both
 * modes): a destructured module-scope value (`const { a } = getEnv(…)`) is
 * never shaken — even `@__PURE__`-annotated — because destructuring may
 * trigger getters or throw; an impure hook-only initialiser is
 * indistinguishable from client init (`getEnv(…)` vs `bootClientAnalytics()`)
 * without exactly the closure analysis below; keepNames registration calls
 * pin hook-only helpers alive; and no esbuild mode reduces an unrelated
 * unused import to a bare side-effect import while deleting a hook-owned one.
 * The distinction that drives every one of those decisions — membership in
 * the stripped hook's dependency closure — is not expressible in a bundler's
 * side-effect model, so this stage computes it itself.
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
 * browser bundle, and a silent leak is worse than a stopped build. The same
 * rule covers a hook this pass can *see* but cannot *stub*: a class, an
 * imported binding re-exported under a hook name, a hook binding the module
 * *reassigns* (`export let getServerData = stub; getServerData = realLoader`),
 * and one it *redeclares* through a hoisted `var` below the top level
 * (`export var getServerData = stub; if (cond) { var getServerData =
 * realLoader }`) — stubbing the declarator would leave the later write to put
 * the real loader back at module-evaluation time, so the build stops rather
 * than shipping the declaration. As a final fail-closed check, the pass
 * re-parses the output it is about to emit and verifies that no binding it
 * decided to drop is still imported or referenced in that artifact — a
 * violated invariant anywhere between the removal decision and the emitted
 * text fails the build instead of leaking.
 *
 * What this pass does: it empties hook bodies, drops the module-scope
 * declarations the hooks were the last reader of — including destructured
 * ones, so neither `const API_KEY = getEnv(...)` nor `const { apiKey } =
 * getEnv(...)` used only by `getServerData` reaches the browser — and removes
 * the hook-only imports that leaves unused. What it does NOT do: reason about
 * a value that is *also* read by browser code, or one reached only through an
 * existing bare side-effect import — those are kept. It is not a general
 * guarantee that every secret stays on the server, but a value used solely by
 * a server-only hook no longer leaks.
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";
import type { TransformContext, TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import {
  COMPILE_SOURCE_MAP_DIRECTIVE_METADATA,
  COMPILE_SOURCE_MAP_INPUT_METADATA,
} from "./compile.ts";

/** Exports that only ever execute on the server. */
const SERVER_ONLY_EXPORTS = ["getServerData", "getStaticData", "getStaticPaths"];

// The compile stage runs before this pass and embeds its input in a development
// sourcemap. Once a hook is stripped, any prior map is stale and may contain or
// point at a verbatim copy of the server-only source. Match only an actual
// trailing directive so source-map-like text inside authored strings survives.
const SOURCE_MAP_SUFFIX =
  /(^|\r?\n)[\t ]*\/\/[#@][\t ]*sourceMappingURL=[^"'`\s]+[\t ]*(?:\r?\n)?$/;

function dropSourceMapSuffix(code: string): string {
  return code.replace(SOURCE_MAP_SUFFIX, "$1");
}

function appendSourceMapDirective(code: string, directive: string): string {
  const separator = code.length > 0 && !code.endsWith("\n") ? "\n" : "";
  return `${code}${separator}${directive}\n`;
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

/**
 * Walk every node in the tree. Returning `false` from `visit` skips the
 * subtree, which is how import statements stay out of the reference count.
 */
function walk(node: Node, visit: (node: Node) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of children(node)) walk(child, visit);
}

function nodeName(value: unknown): string | null {
  if (!isNode(value)) return null;
  const name = value.name;
  return typeof name === "string" ? name : null;
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

/** Every identifier node a destructuring pattern binds (binding positions only). */
function patternBindingIdentifiers(pattern: Node): Node[] {
  const ids: Node[] = [];

  const collect = (node: Node): void => {
    if (node.type === "TSParameterProperty") {
      if (isNode(node.parameter)) collect(node.parameter);
      return;
    }

    if (node.type === "Identifier") {
      ids.push(node);
      return;
    }

    if (node.type === "AssignmentPattern") {
      if (isNode(node.left)) collect(node.left);
      return;
    }

    if (node.type === "RestElement") {
      if (isNode(node.argument)) collect(node.argument);
      return;
    }

    if (node.type === "ArrayPattern") {
      for (const element of Array.isArray(node.elements) ? node.elements : []) {
        if (isNode(element)) collect(element);
      }
      return;
    }

    if (node.type === "ObjectPattern") {
      for (const property of Array.isArray(node.properties) ? node.properties : []) {
        if (!isNode(property)) continue;
        if (property.type === "RestElement") {
          if (isNode(property.argument)) collect(property.argument);
          continue;
        }
        if (property.type === "ObjectProperty" && isNode(property.value)) {
          collect(property.value);
        }
      }
    }
  };

  collect(pattern);

  return ids;
}

/** Every binding name a destructuring pattern introduces. */
function patternBoundNames(pattern: Node): string[] {
  const names: string[] = [];
  for (const id of patternBindingIdentifiers(pattern)) {
    const name = nodeName(id);
    if (name) names.push(name);
  }
  return names;
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
      if (!isHook(nodeName(specifier.exported))) continue;

      // `export { x as getServerData } from "./loader"` never binds `x` here,
      // so there is no body to empty and the module it points at is still
      // pulled into the graph.
      if (isNode(statement.source)) {
        unhandled.push(`export { … as ${nodeName(specifier.exported)} } from …`);
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

  return { locals, unhandled };
}

/**
 * Empty the body of every exported server-only hook. Emptying rather than
 * deleting keeps the binding, so an export clause or re-export stays valid.
 *
 * Returns the set of hook names that were actually emptied. The caller
 * compares it against the full target set: a hook this pass identified but
 * could not stub (a class declaration, an imported binding re-exported under
 * a hook name) must fail the build, because emitting it unchanged would ship
 * the server declaration to the browser.
 */
function emptyServerOnlyHooks(
  body: Node[],
  targets: Set<string>,
  stubs: { body: Node; init: Node },
): Set<string> {
  const emptied = new Set<string>();
  if (targets.size === 0) return emptied;

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
        emptied.add(name);
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
        emptied.add(name);
      }
    }
  }

  return emptied;
}

/** A top-level declaration and the binding names / binding-id nodes it owns. */
interface ModuleScopeDecl {
  statement: Node;
  declarator?: Node;
  names: string[];
}

/**
 * Non-exported top-level `const`/`let`/`var`/`function`/`class` declarations
 * whose bindings we could safely drop if nothing references them. Exported
 * declarations are part of the module's contract and are never candidates.
 *
 * A destructuring declarator (`const { apiKey } = getEnv(...)`) is a candidate
 * as a single unit carrying every name its pattern binds: it is removed only
 * when *all* of them fall out of use, so a pattern the client still partly
 * reads survives whole. This is what stops a destructured server value from
 * shipping — esbuild's tree-shaker never removes a destructuring of a call,
 * even a `@__PURE__`-annotated one, because the pattern itself may trigger
 * getters or throw. Default-value and computed-key references inside the
 * pattern remain part of the declaration's dependency closure, but are not
 * external browser consumers of sibling bindings from that same pattern.
 */
function moduleScopeDeclarations(body: Node[]): ModuleScopeDecl[] {
  const decls: ModuleScopeDecl[] = [];

  for (const statement of body) {
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      const id = statement.id;
      const name = nodeName(id);
      if (name && isNode(id)) decls.push({ statement, names: [name] });
      continue;
    }

    if (statement.type === "VariableDeclaration") {
      for (
        const declarator of Array.isArray(statement.declarations) ? statement.declarations : []
      ) {
        if (!isNode(declarator)) continue;
        const id = declarator.id;
        if (!isNode(id)) continue;

        const bindingIds = id.type === "Identifier" ? [id] : patternBindingIdentifiers(id);
        const names: string[] = [];
        for (const bindingId of bindingIds) {
          const name = nodeName(bindingId);
          if (name) names.push(name);
        }
        // A pattern with an unnameable binding cannot be reasoned about; a
        // pattern binding nothing (`const {} = …`) has no dead name to chase.
        // Either way the declarator simply stays.
        if (names.length === 0 || names.length !== bindingIds.length) continue;

        decls.push({ statement, declarator, names });
      }
    }
  }

  return decls;
}

/** Every binding declared directly by the module, including exported declarations. */
function moduleScopeBindingNames(body: Node[]): Set<string> {
  const names = new Set<string>();

  for (const statement of body) {
    const declaration = statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration"
      ? statement.declaration
      : statement;
    if (!isNode(declaration)) continue;

    if (
      declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration"
    ) {
      const name = nodeName(declaration.id);
      if (name) names.add(name);
      continue;
    }

    if (declaration.type !== "VariableDeclaration") continue;
    for (
      const declarator of Array.isArray(declaration.declarations) ? declaration.declarations : []
    ) {
      if (!isNode(declarator) || !isNode(declarator.id)) continue;
      for (const name of patternBoundNames(declarator.id)) names.add(name);
    }
  }

  return names;
}

/** Whether a name is bound in the current lexical stack. */
interface LexicalScope {
  kind: "var" | "block";
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
  const rootScope: LexicalScope = { kind: "var", names: new Set() };

  const currentVarScope = (scopes: LexicalScope[]): LexicalScope =>
    scopes.find((scope) => scope.kind === "var") ?? scopes[0] ?? rootScope;

  const bindPatternNames = (scope: LexicalScope, value: unknown): void => {
    if (!isNode(value)) return;
    for (const name of patternBoundNames(value)) scope.names.add(name);
  };

  const bindDirectStatements = (scope: LexicalScope, statements: unknown[]): void => {
    for (const statement of statements) {
      if (!isNode(statement)) continue;
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        bindPatternNames(scope, statement.id);
        continue;
      }
      if (statement.type !== "VariableDeclaration") continue;
      for (
        const declarator of Array.isArray(statement.declarations) ? statement.declarations : []
      ) {
        if (isNode(declarator)) bindPatternNames(scope, declarator.id);
      }
    }
  };

  const bindDirectDeclarations = (scope: LexicalScope, node: Node): void => {
    const body = node.body;
    if (Array.isArray(body)) bindDirectStatements(scope, body);
  };

  const bindNestedVarDeclarations = (scope: LexicalScope, node: Node): void => {
    for (const child of children(node)) {
      if (
        child.type === "FunctionDeclaration" || child.type === "FunctionExpression" ||
        child.type === "ArrowFunctionExpression" || child.type === "ObjectMethod" ||
        child.type === "ClassMethod" || child.type === "ClassDeclaration" ||
        child.type === "ClassExpression" || child.type === "StaticBlock"
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
    for (const child of children(node)) visit(child, scopes);
  };

  const visitPatternRuntime = (pattern: Node, scopes: LexicalScope[]): void => {
    if (pattern.type === "TSParameterProperty") {
      for (const decorator of Array.isArray(pattern.decorators) ? pattern.decorators : []) {
        if (isNode(decorator)) visit(decorator, scopes);
      }
      if (isNode(pattern.parameter)) visitPatternRuntime(pattern.parameter, scopes);
      return;
    }

    if (pattern.type === "Identifier") return;

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
    const targetScope = node.kind === "var" ? currentVarScope(scopes) : scopes[0] ?? rootScope;
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
    const functionScope: LexicalScope = { kind: "var", names: new Set() };
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
      if (isNode(caseNode) && Array.isArray(caseNode.consequent)) {
        bindDirectStatements(switchScope, caseNode.consequent);
      }
    }

    for (const caseNode of Array.isArray(node.cases) ? node.cases : []) {
      if (!isNode(caseNode)) continue;
      if (isNode(caseNode.test)) visit(caseNode.test, scoped);
      for (const statement of Array.isArray(caseNode.consequent) ? caseNode.consequent : []) {
        if (isNode(statement)) visit(statement, scoped);
      }
    }
  };

  const visitTsExpression = (node: Node, scopes: LexicalScope[]): boolean => {
    if (
      node.type === "TSAsExpression" || node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression" || node.type === "TSInstantiationExpression" ||
      node.type === "TSSatisfiesExpression"
    ) {
      if (isNode(node.expression)) visit(node.expression, scopes);
      return true;
    }

    if (node.type.startsWith("TS")) return true;
    return false;
  };

  const visit = (node: Node, scopes: LexicalScope[]): void => {
    if (node.type === "ImportDeclaration") return;
    if (visitTsExpression(node, scopes)) return;

    if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      const name = nodeName(node);
      if (name && !isLexicallyBound(name, scopes)) free.add(name);
      return;
    }

    if (node.type === "Program" || node.type === "BlockStatement") {
      const scope: LexicalScope = { kind: "block", names: new Set() };
      bindDirectDeclarations(scope, node);
      for (const statement of Array.isArray(node.body) ? node.body : []) {
        if (isNode(statement)) visit(statement, [scope, ...scopes]);
      }
      return;
    }

    if (node.type === "StaticBlock") {
      const scope: LexicalScope = { kind: "var", names: new Set() };
      bindDirectDeclarations(scope, node);
      bindNestedVarDeclarations(scope, node);
      for (const statement of Array.isArray(node.body) ? node.body : []) {
        if (isNode(statement)) visit(statement, [scope, ...scopes]);
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

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.type === "ClassDeclaration") bindPatternNames(scopes[0] ?? rootScope, node.id);
      const classScope: LexicalScope = { kind: "block", names: new Set() };
      bindPatternNames(classScope, node.id);
      const classScopes = [classScope, ...scopes];
      const body = node.body;
      if (isNode(node.superClass)) visit(node.superClass, classScopes);
      if (isNode(body)) visitChildren(body, classScopes);
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

    if (node.type === "ObjectProperty" || node.type === "ClassProperty") {
      visitObjectMember(node, scopes);
      return;
    }

    if (node.type === "ObjectMethod" || node.type === "ClassMethod") {
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
 * emptied — the seed of the hook's dependency closure. Must be collected before
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
 * Names written by assignment-like expressions anywhere in the module:
 * `getServerData = realLoader`, `({ getServerData } = loaders)`,
 * `getServerData++`, `for (getServerData of loaders) …`. Member writes
 * (`obj.getServerData = …`) assign a property, not a binding, and are not
 * collected. Import statements never contain assignments and are skipped.
 *
 * Used to fail closed on a module that reassigns a hook binding: the pass can
 * stub only the declarator, and the assignment would put the real loader back
 * at module-evaluation time. Collection is deliberately scope-blind — a nested
 * local that shadows a hook name and is assigned also stops the build, because
 * on this boundary a stopped build is recoverable and a shipped loader is not.
 */
function assignedNames(body: Node[]): Set<string> {
  const assigned = new Set<string>();

  const collectTargets = (target: Node): void => {
    if (target.type === "Identifier") {
      const name = nodeName(target);
      if (name) assigned.add(name);
      return;
    }

    if (target.type === "AssignmentPattern") {
      if (isNode(target.left)) collectTargets(target.left);
      return;
    }

    if (target.type === "RestElement" || target.type === "SpreadElement") {
      if (isNode(target.argument)) collectTargets(target.argument);
      return;
    }

    // A destructuring assignment target parses as a pattern or, depending on
    // the parser, as the expression form of the same shape.
    if (target.type === "ArrayPattern" || target.type === "ArrayExpression") {
      for (const element of Array.isArray(target.elements) ? target.elements : []) {
        if (isNode(element)) collectTargets(element);
      }
      return;
    }

    if (target.type === "ObjectPattern" || target.type === "ObjectExpression") {
      for (const property of Array.isArray(target.properties) ? target.properties : []) {
        if (!isNode(property)) continue;
        if (isNode(property.argument)) {
          collectTargets(property.argument);
          continue;
        }
        if (isNode(property.value)) collectTargets(property.value);
      }
      return;
    }

    if (isNode(target.expression)) collectTargets(target.expression);
  };

  for (const statement of body) {
    if (statement.type === "ImportDeclaration") continue;

    walk(statement, (node) => {
      if (node.type === "ImportDeclaration") return false;

      if (node.type === "AssignmentExpression" && isNode(node.left)) collectTargets(node.left);
      if (node.type === "UpdateExpression" && isNode(node.argument)) collectTargets(node.argument);
      if (
        (node.type === "ForInStatement" || node.type === "ForOfStatement") &&
        isNode(node.left) && node.left.type !== "VariableDeclaration"
      ) {
        collectTargets(node.left);
      }

      return true;
    });
  }

  return assigned;
}

/**
 * Names a `var` hoists into module scope from somewhere below the top level:
 * `{ var getServerData = realLoader }`, `if (cond) { var getServerData = … }`,
 * `for (var getServerData of realLoaders) {}`, and the same inside `switch`,
 * `try`, `while` and labelled statements.
 *
 * `emptyServerOnlyHooks` only rewrites top-level declarations, and
 * `assignedNames` only sees assignment and update expressions, so a hoisted
 * redeclaration slipped past both: the stub was emitted *and* the real loader
 * survived below it, overwriting the stub the moment the module evaluated.
 * Treating these as binding writes fails the build instead, exactly as a
 * plain reassignment does.
 *
 * Traversal stops at every construct that starts a new `var` scope — function
 * bodies, class bodies, class static blocks and TypeScript-only nodes — so a
 * nested `function Page() { var getServerData = 1 }` is a local of `Page` and
 * is not reported.
 */
function hoistedVarNames(body: Node[]): Set<string> {
  const hoisted = new Set<string>();

  const startsVarScope = (node: Node): boolean =>
    node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" || node.type === "ObjectMethod" ||
    node.type === "ClassMethod" || node.type === "ClassDeclaration" ||
    node.type === "ClassExpression" || node.type === "StaticBlock" ||
    node.type.startsWith("TS");

  const collect = (node: Node): void => {
    for (const child of children(node)) {
      if (startsVarScope(child)) continue;

      if (child.type === "VariableDeclaration" && child.kind === "var") {
        for (const declarator of Array.isArray(child.declarations) ? child.declarations : []) {
          if (!isNode(declarator) || !isNode(declarator.id)) continue;
          for (const name of patternBoundNames(declarator.id)) hoisted.add(name);
        }
      }

      collect(child);
    }
  };

  // Only statements *below* the top level hoist past the stubber: a top-level
  // `var` declaration is a declaration `emptyServerOnlyHooks` already rewrites,
  // so entering the tree at the unwrapped declaration keeps it out of the set
  // while still reaching anything nested inside its initialisers.
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") continue;

    const declaration = statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration"
      ? statement.declaration
      : statement;
    const root = isNode(declaration) ? declaration : statement;
    if (startsVarScope(root)) continue;

    collect(root);
  }

  return hoisted;
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
function compilerNameHelperBindings(body: Node[]): Set<string> {
  const initializers = new Map<string, Node>();
  for (const statement of body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of Array.isArray(statement.declarations) ? statement.declarations : []) {
      if (!isNode(declarator) || !isNode(declarator.init)) continue;
      const name = nodeName(declarator.id);
      if (name) initializers.set(name, declarator.init);
    }
  }

  const definePropertyBindings = new Set<string>();
  for (const [name, init] of initializers) {
    if (isObjectDefineProperty(init)) definePropertyBindings.add(name);
  }

  const helpers = new Set<string>();
  for (const [name, init] of initializers) {
    if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") continue;
    const params = Array.isArray(init.params) ? init.params.filter(isNode) : [];
    if (params.length !== 2) continue;
    const targetParam = nodeName(params[0]);
    const valueParam = nodeName(params[1]);
    if (!targetParam || !valueParam) continue;

    const call = returnedCall(init);
    if (!call) continue;
    const callee = isNode(call.callee) ? call.callee : undefined;
    const callsDefineProperty = isObjectDefineProperty(callee) ||
      (callee?.type === "Identifier" && definePropertyBindings.has(nodeName(callee) ?? ""));
    if (!callsDefineProperty) continue;

    const args = Array.isArray(call.arguments) ? call.arguments.filter(isNode) : [];
    if (
      args.length === 3 && nodeName(args[0]) === targetParam &&
      stringLiteralText(args[1]) === "name" && isNameDescriptor(args[2], valueParam)
    ) {
      helpers.add(name);
    }
  }

  return helpers;
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

/**
 * References to a module declaration after removing only that declaration and
 * its compiler-generated name registration from the analysis tree. A real
 * module read becomes free; a same-named binding inside client code remains
 * lexically bound and does not keep server state alive.
 */
function referencesOutsideModuleScopeDeclaration(
  body: Node[],
  declaration: ModuleScopeDecl,
  nameRegistrations: CompilerNameRegistration[],
): Set<string> {
  const ignoredStatements = new Set(
    nameRegistrations.filter((registration) => declaration.names.includes(registration.targetName))
      .map((registration) => registration.statement),
  );
  const remainingBody: Node[] = [];

  for (const statement of body) {
    if (ignoredStatements.has(statement)) continue;
    if (statement !== declaration.statement) {
      remainingBody.push(statement);
      continue;
    }
    if (!declaration.declarator) continue;

    const declarators = Array.isArray(statement.declarations)
      ? statement.declarations.filter(isNode)
      : [];
    const remainingDeclarators = declarators.filter((candidate) =>
      candidate !== declaration.declarator
    );
    if (remainingDeclarators.length > 0) {
      remainingBody.push({ ...statement, declarations: remainingDeclarators });
    }
  }

  return freeReferencedIdentifiers({ type: "Program", body: remainingBody });
}

/**
 * Drop the top-level declarations the emptied server-only hooks closed over.
 *
 * Scope is the *dependency closure of the stripped hooks*, not "everything
 * unreferenced". A declaration is removed only when (a) it is reached from the
 * hook's own reference graph — seeded from `hookClosure` and grown through the
 * initialisers of declarations already removed — and (b) nothing surviving in
 * the module still references it. So `const API_KEY = getEnv(...)` read only by
 * `getServerData` goes (letting `dropUnusedImportBindings` drop the import
 * next), while an unrelated `const _ = bootClientAnalytics()` — never part of
 * the hook graph — is left intact along with its side effect. Iterates to a
 * fixpoint: removing one binding can leave a helper it was the last user of
 * newly dead *within the closure*.
 *
 * Every binding name a removal takes out is added to `removedNames`, so the
 * caller can verify — fail-closed — that none of them survives in the final
 * output.
 */
function dropUnusedModuleScopeBindings(
  body: Node[],
  hookClosure: Set<string>,
  removedNames: Set<string>,
): Node[] {
  let current = body;

  for (;;) {
    const decls = moduleScopeDeclarations(current);
    if (decls.length === 0) return current;

    // Esbuild's generated name-registration call is metadata for a declaration,
    // not an independent browser consumer of it. Ignore that target reference
    // when deciding liveness, and remove the call together with a declaration
    // that proves hook-only.
    const nameRegistrations = compilerNameRegistrations(current);

    const removableStatements = new Set<Node>();
    const removableDeclarators = new Map<Node, Set<Node>>();
    const removedDecls: ModuleScopeDecl[] = [];
    for (const decl of decls) {
      const inClosure = decl.names.some((name) => hookClosure.has(name));
      if (!inClosure) continue;
      const externalReferences = referencesOutsideModuleScopeDeclaration(
        current,
        decl,
        nameRegistrations,
      );
      const unused = decl.names.every((name) => !externalReferences.has(name));
      if (!unused) continue;

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
      for (const name of decl.names) removedNames.add(name);
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
 *
 * Every binding a deletion or reduction removes is added to `removedNames` for
 * the caller's fail-closed output verification.
 */
function dropUnusedImportBindings(
  body: Node[],
  hookClosure: Set<string>,
  removedNames: Set<string>,
): Node[] {
  // Imports are not lexical declarations inside this synthetic program, so a
  // real read of an imported binding is free. A nested client binding with the
  // same spelling is bound in its own scope and does not keep the import alive.
  const referenced = freeReferencedIdentifiers({ type: "Program", body });

  return body.filter((statement) => {
    if (statement.type !== "ImportDeclaration") return true;
    if (statement.importKind === "type") return true;

    const bindings = importedBindings(statement);
    // Already a side-effect import: nothing to drop.
    if (bindings.length === 0) return true;
    if (bindings.some((binding) => referenced.has(binding))) return true;

    for (const binding of bindings) removedNames.add(binding);

    const source = isNode(statement.source) ? statement.source.value : undefined;
    const isKnownDroppableSource = typeof source === "string" &&
      (source.startsWith("node:") || source === "veryfront" || source.startsWith("veryfront/"));
    // Two different reasons to delete rather than reduce, and one to reduce.
    // A node: or veryfront source is unsafe or pointless as a browser
    // side-effect import whatever used it. A project-relative source is deleted
    // only when the stripped hook owned every binding, because that module is
    // reached solely through server-only code and a bare side-effect import
    // would keep its whole transitive graph in the browser artifact. An import
    // the hook never touched was already unused before this pass ran, so it
    // keeps the legacy reduction and its side effects with it.
    if (isKnownDroppableSource || bindings.every((binding) => hookClosure.has(binding))) {
      return false;
    }

    statement.specifiers = [];
    return true;
  });
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
 * safe outcome — the alternative is shipping the loader to the browser.
 */
export async function stripServerOnlyExports(
  code: string,
  filePath?: string,
): Promise<string> {
  // Cheap pre-check: no mention of a hook means no parse.
  if (!SERVER_ONLY_EXPORTS.some((name) => code.includes(name))) return code;

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

    ast = await parser.parse({ code, filePath: filePath ?? "module.tsx" });
    body = bodyOf(ast);
  } catch (error) {
    throw new ServerExportStripError(
      filePath,
      error instanceof Error ? error.message : String(error),
    );
  }

  const { locals, unhandled } = exportedHookBindings(body);
  if (unhandled.length > 0) {
    throw new ServerExportStripError(filePath, `it is exported as \`${unhandled[0]}\``);
  }
  if (locals.size === 0) return code;

  // Fail closed on a reassigned hook binding: `export let getServerData =
  // stub; getServerData = realLoader` leaves nothing this pass can neutralise.
  // Stubbing the declarator would report the hook as emptied while the
  // module-scope assignment puts the real loader back at evaluation time, so
  // the loader body and everything it references would ship to the browser
  // silently. The build stops instead.
  const assigned = assignedNames(body);
  const reassigned = [...locals].filter((name) => assigned.has(name));
  if (reassigned.length > 0) {
    throw new ServerExportStripError(
      filePath,
      `\`${reassigned[0]}\` is reassigned after its declaration, so the assigned ` +
        `server loader would ship to the browser and overwrite the stripped stub`,
    );
  }

  // Same failure, reached by hoisting rather than by assignment: a `var`
  // redeclaration below the top level (`{ var getServerData = realLoader }`,
  // `if (…) { var … }`, `for (var … of …)`) binds the same module-scope name,
  // and its initialiser runs after the stubbed declaration. The stubber only
  // rewrites top-level declarations, so the emitted artifact would carry both
  // the stub and the real loader.
  const hoisted = hoistedVarNames(body);
  const redeclared = [...locals].filter((name) => hoisted.has(name));
  if (redeclared.length > 0) {
    throw new ServerExportStripError(
      filePath,
      `\`${redeclared[0]}\` is redeclared by a hoisted \`var\` below the module's ` +
        `top level, so the hoisted server loader would ship to the browser and ` +
        `overwrite the stripped stub`,
    );
  }

  // Capture what the hooks reference *before* emptying them, so pruning is
  // scoped to the hooks' dependency closure and never touches unrelated
  // top-level declarations (which may run browser side effects).
  const hookClosure = hookReferencedIdentifiers(body, locals);

  // Fail closed on a hook this pass identified but could not stub — a class
  // declaration, an imported binding re-exported under a hook name, or any
  // other form outside `emptyServerOnlyHooks`'s reach. Emitting the module
  // with the declaration intact would ship the loader to the browser.
  const emptied = emptyServerOnlyHooks(body, locals, stubs);
  const missed = [...locals].filter((name) => !emptied.has(name));
  if (missed.length > 0) {
    throw new ServerExportStripError(
      filePath,
      `\`${missed[0]}\` is exported but its declaration is not a function or ` +
        `variable this pass can stub`,
    );
  }

  // Drop the module-scope state the emptied hooks were the last user of, then
  // the imports that leaves unused. Order matters: pruning `const API_KEY =
  // getEnv(...)` is what makes the `veryfront` import droppable.
  const removedNames = new Set<string>();
  const pruned = dropUnusedModuleScopeBindings(body, hookClosure, removedNames);
  const finalBody = dropUnusedImportBindings(pruned, hookClosure, removedNames);

  setBody(ast, finalBody);

  const generated = await parser.generate(ast);

  // Fail-closed output verification, run against the artifact itself: the
  // emitted code is re-parsed and scanned for every binding this pass decided
  // to drop, as an import or as a reference. Checking the freshly parsed
  // output — not the tree the nodes were structurally deleted from — means a
  // regression anywhere between the removal decision and the emitted text,
  // the generator included, stops the build instead of leaking.
  if (removedNames.size > 0) {
    let emittedBody: Node[];
    try {
      const emitted = await parser.parse({
        code: generated.code,
        filePath: filePath ?? "module.tsx",
      });
      emittedBody = bodyOf(emitted);
    } catch (error) {
      throw new ServerExportStripError(
        filePath,
        `the stripped output no longer parses: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const residual = freeReferencedIdentifiers({ type: "Program", body: emittedBody });
    for (const binding of moduleScopeBindingNames(emittedBody)) residual.add(binding);
    for (const statement of emittedBody) {
      if (statement.type !== "ImportDeclaration") continue;
      for (const binding of importedBindings(statement)) residual.add(binding);
    }
    const leaked = [...removedNames].filter((name) => residual.has(name));
    if (leaked.length > 0) {
      throw new ServerExportStripError(
        filePath,
        `the server-only binding \`${leaked[0]}\` still appears in the stripped output`,
      );
    }
  }

  return dropSourceMapSuffix(generated.code);
}

export const browserServerExportsStripPlugin: TransformPlugin = {
  name: "browser-server-exports-strip",
  // After esbuild compile and CSS strip, before any import resolution, so the
  // dropped bindings are never rewritten or pre-fetched.
  stage: TransformStage.COMPILE + 0.6,
  condition: (ctx: TransformContext) => ctx.target === "browser",
  transform: async (ctx: TransformContext) => {
    const directive = ctx.metadata.get(COMPILE_SOURCE_MAP_DIRECTIVE_METADATA);
    const compileInput = ctx.metadata.get(COMPILE_SOURCE_MAP_INPUT_METADATA);
    ctx.metadata.delete(COMPILE_SOURCE_MAP_DIRECTIVE_METADATA);
    ctx.metadata.delete(COMPILE_SOURCE_MAP_INPUT_METADATA);
    const result = await stripServerOnlyExports(ctx.code, ctx.filePath);
    return result === ctx.code && compileInput === ctx.code && typeof directive === "string"
      ? appendSourceMapDirective(result, directive)
      : result;
  },
};
