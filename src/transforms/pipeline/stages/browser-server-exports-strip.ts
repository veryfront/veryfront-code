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
 * an existing bare side-effect import — those are kept. It is not a general
 * guarantee that every secret stays on the server, but a value used solely by a
 * server-only hook no longer leaks.
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";
import type { TransformContext, TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";

/** Exports that only ever execute on the server. */
const SERVER_ONLY_EXPORTS = ["getServerData", "getStaticData", "getStaticPaths"];

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
  const source = isNode(program) ? program : (ast as unknown as Node);
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

/** Every binding name a destructuring pattern introduces. */
function patternBoundNames(pattern: Node): string[] {
  const names: string[] = [];

  const collect = (node: Node): void => {
    if (node.type === "Identifier") {
      const name = nodeName(node);
      if (name) names.push(name);
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
 * `{ hashOf: 1 }`). Over-counting only ever keeps an import.
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
          node.type === "ClassMethod" || node.type === "ClassProperty"
      ? node.key
      : undefined;

    if (node.computed === true) return;
    if (isNode(property)) fixedNames.add(property);
  };

  for (const statement of body) {
    if (statement.type === "ImportDeclaration") continue;

    walk(statement, (node) => {
      if (node.type === "ImportDeclaration") return false;

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

/**
 * Non-exported top-level `const`/`let`/`var`/`function`/`class` declarations
 * whose bindings we could safely drop if nothing references them. Exported
 * declarations are part of the module's contract and are never candidates.
 * Destructuring declarations are skipped — a pattern can carry default-value
 * references, and a partial removal is not worth the risk.
 */
function moduleScopeDeclarations(body: Node[]): ModuleScopeDecl[] {
  const decls: ModuleScopeDecl[] = [];

  for (const statement of body) {
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
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
        if (isNode(id) && id.type === "Identifier") {
          const name = nodeName(id);
          if (name) variableDecls.push({ statement, declarator, names: [name], bindingIds: [id] });
        } else {
          variableDecls.length = 0;
          break;
        }
      }

      decls.push(...variableDecls);
    }
  }

  return decls;
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

  const bindDirectDeclarations = (scope: LexicalScope, node: Node): void => {
    const body = node.body;
    if (!Array.isArray(body)) return;

    for (const statement of body) {
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

  const bindNestedVarDeclarations = (scope: LexicalScope, node: Node): void => {
    for (const child of children(node)) {
      if (
        child.type === "FunctionDeclaration" || child.type === "FunctionExpression" ||
        child.type === "ArrowFunctionExpression" || child.type === "ObjectMethod" ||
        child.type === "ClassMethod"
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
      const body = node.body;
      if (isNode(body)) visitChildren(body, scopes);
      if (isNode(node.superClass)) visit(node.superClass, scopes);
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
 */
function dropUnusedModuleScopeBindings(body: Node[], hookClosure: Set<string>): Node[] {
  let current = body;

  for (;;) {
    const decls = moduleScopeDeclarations(current);
    if (decls.length === 0) return current;

    const excluded = new WeakSet<Node>();
    for (const decl of decls) for (const id of decl.bindingIds) excluded.add(id);

    const referenced = referencedIdentifiers(current, excluded);

    const removableStatements = new Set<Node>();
    const removableDeclarators = new Map<Node, Set<Node>>();
    const removedDecls: ModuleScopeDecl[] = [];
    for (const decl of decls) {
      const inClosure = decl.names.some((name) => hookClosure.has(name));
      const unused = decl.names.every((name) => !referenced.has(name));
      if (!inClosure || !unused) continue;

      removedDecls.push(decl);
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

    // Grow the closure through the removed declarations' initializers, so a
    // chain that only fed the hook (`const RAW = getEnv(); const TOKEN = RAW…`)
    // is pruned end to end while unrelated declarations stay outside it.
    for (const decl of removedDecls) {
      const dependencyRoot = decl.declarator
        ? (isNode(decl.declarator.init) ? decl.declarator.init : undefined)
        : decl.statement;
      if (!dependencyRoot) continue;
      for (const name of freeReferencedIdentifiers(dependencyRoot)) {
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
 */
function dropUnusedImportBindings(body: Node[], hookClosure: Set<string>): Node[] {
  const referenced = referencedIdentifiers(body);

  return body.filter((statement) => {
    if (statement.type !== "ImportDeclaration") return true;
    if (statement.importKind === "type") return true;

    const bindings = importedBindings(statement);
    // Already a side-effect import: nothing to drop.
    if (bindings.length === 0) return true;
    if (bindings.some((binding) => referenced.has(binding))) return true;

    const source = isNode(statement.source) ? statement.source.value : undefined;
    const isKnownDroppableSource = typeof source === "string" &&
      (source.startsWith("node:") || source === "veryfront" || source.startsWith("veryfront/"));
    if (isKnownDroppableSource || bindings.every((binding) => hookClosure.has(binding))) {
      return false;
    }

    statement.specifiers = [];
    return true;
  });
}

function setBody(ast: ASTNode, body: Node[]): void {
  const program = (ast as { program?: unknown }).program;
  const target = isNode(program) ? program : (ast as unknown as Node);
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
export async function stripServerOnlyExports(code: string, filePath?: string): Promise<string> {
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

  // Capture what the hooks reference *before* emptying them, so pruning is
  // scoped to the hooks' dependency closure and never touches unrelated
  // top-level declarations (which may run browser side effects).
  const hookClosure = hookReferencedIdentifiers(body, locals);

  if (!emptyServerOnlyHooks(body, locals, stubs)) return code;

  // Drop the module-scope state the emptied hooks were the last user of, then
  // the imports that leaves unused. Order matters: pruning `const API_KEY =
  // getEnv(...)` is what makes the `veryfront` import droppable.
  const pruned = dropUnusedModuleScopeBindings(body, hookClosure);
  setBody(ast, dropUnusedImportBindings(pruned, hookClosure));

  const generated = await parser.generate(ast);
  return generated.code;
}

export const browserServerExportsStripPlugin: TransformPlugin = {
  name: "browser-server-exports-strip",
  // After esbuild compile and CSS strip, before any import resolution, so the
  // dropped bindings are never rewritten or pre-fetched.
  stage: TransformStage.COMPILE + 0.6,
  condition: (ctx: TransformContext) => ctx.target === "browser",
  transform: (ctx: TransformContext) => stripServerOnlyExports(ctx.code, ctx.filePath),
};
