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
 * never shaken, even `@__PURE__`-annotated ones, because destructuring may
 * trigger getters or throw; an impure hook-only initialiser is
 * indistinguishable from client init (`getEnv(…)` vs `bootClientAnalytics()`)
 * without exactly the closure analysis below; keepNames registration calls
 * pin hook-only helpers alive; and no esbuild mode reduces an unrelated
 * unused import to a bare side-effect import while deleting a hook-owned one.
 * The distinction that drives every one of those decisions, membership in
 * the stripped hook's dependency closure, is not expressible in a bundler's
 * side-effect model, so this stage computes it itself.
 *
 * The pass runs on the AST from the `CodeParser` contract, for the same reason
 * `rendering/rsc/export-extractor.ts` does: a module is not text. Matching
 * declarations by hand means a private function that shares a hook's name gets
 * emptied, a `}` inside a regular expression literal ends a body early, and a
 * minified statement parses differently from the one a developer wrote.
 *
 * Liveness is computed as *reachability over the module's binding graph*, not
 * as "is this name mentioned somewhere else". The nodes are every module-scope
 * binding, including a `var` that hoists out of a block, `if`, `try`,
 * `switch`, loop or label, which binds module scope exactly as a top-level
 * declaration does. The roots are what the module still *runs*: its surviving
 * exports, the client component, and any side-effectful top-level statement,
 * which keeps whatever it references. A declaration that merely introduces a
 * name (a function, a `var dead = helper`, a class with no decorator, computed
 * key or static initialiser) runs nothing, so it is elided from the roots and
 * cannot vouch for anything: a private helper the module never calls used to be
 * treated as unconditionally live and kept `const KEY = getEnv(…)` and its
 * `node:crypto` import in the browser artifact.
 *
 * Roots and edges are drawn from different parts of a declaration, because
 * "what runs at module load" and "what this binding reads" are different
 * questions. A declaration roots only what it *evaluates*: `const handler =
 * memo(() => KEY)` calls `memo` when the module loads, and reads `KEY` only if
 * something calls the arrow, which needs `handler`. So the arrow's body is an
 * edge out of `handler`, not a root, and a dead declaration can no longer
 * vouch for a secret buried in a callback it never runs. An immediately
 * invoked function is not deferred; nor is a class static block, a static
 * field initialiser, a computed member key, a decorator or a heritage clause,
 * all of which run where the class is defined.
 *
 * The edges are genuine reads, which is narrower than "identifier occurrences":
 * a statement label, the *exported* half of an export specifier
 * (`export { other as KEY }`), a non-computed property or JSX attribute name,
 * and a declarator's reads of its own pattern's siblings all spell a name
 * without reading the binding behind it.
 *
 * Deciding this per declaration instead, asking each one whether its name is
 * mentioned elsewhere, cannot see a cycle. Two hook-only helpers that call
 * each other are each the other's last consumer, so neither is ever removable
 * and the secret they close over ships with them. Reachability drops the whole
 * unreachable component however long it is.
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
 * imported binding re-exported under a hook name, a hook exported under an
 * ES2022 string name (`export { loadIt as "getServerData" }`) or as a namespace
 * re-export (`export * as getServerData from …`), a hook binding the module
 * *reassigns* (`export let getServerData = stub; getServerData = realLoader`),
 * and one it *redeclares* through a hoisted `var` below the top level
 * (`export var getServerData = stub; if (cond) { var getServerData =
 * realLoader }`): stubbing the declarator would leave the later write to put
 * the real loader back at module-evaluation time, so the build stops rather
 * than shipping the declaration. It covers two more cases on the other side of
 * the analysis: a binding the graph proves dead but that sits in a position
 * with no declaration to cut out, such as the `for (var KEY of …)` head, whose
 * binding is what the loop assigns to; and a dead binding read only from a
 * deferred body of a declaration that does run (`const handler = memo(() =>
 * KEY)` with nothing reading `handler`), where keeping the binding ships the
 * secret and cutting it leaves the surviving call referring to nothing.
 *
 * As a final check the pass re-parses the artifact it is about to emit and
 * verifies that no binding it *chose to remove* is still imported or referenced
 * there, so a removal that the tree edits or the generator did not actually
 * carry out fails the build instead of leaking. That check is scoped to those
 * names and no further: it does not second-guess which bindings were chosen,
 * so it neither catches a secret this pass decided to keep nor vetoes a removal
 * that should not have happened. The elision, taint and reachability rules
 * below are what decide that, and the checks above are what stop the build when
 * they cannot.
 *
 * What this pass does: it empties hook bodies, drops every module-scope binding
 * in the hooks' dependency closure that nothing surviving can reach, including
 * destructured ones and ones a nested `var` hoists up, so neither
 * `const API_KEY = getEnv(...)` nor `const { apiKey } = getEnv(...)` nor
 * `if (cond) { var API_KEY = getEnv(...) }` used only by `getServerData`
 * reaches the browser, and removes the hook-only imports that leaves unused.
 * Unreachable code holding those bindings goes with them, however far it sits
 * from the hook: a private helper nothing calls, a dead class, a dead helper
 * cycle, a `if (…) { var debug = … }` dev aid.
 *
 * What it does NOT do: rewrite or delete code the module *runs*. This pass
 * removes bindings, never side effects, so a value that surviving
 * module-evaluation code reads is kept however server-only it looks. That
 * covers a value browser code also reads, one a bare top-level statement
 * references, and (the case that surprises) a declaration nothing reaches
 * whose own initialiser still runs and reads the value while running:
 * `const boot = initAnalytics(KEY)`, `Object.defineProperty(box, "run", …)`,
 * `const dead = new Wrapper(KEY)`, `` tag`…${KEY}` ``, `const { a } = KEY`,
 * `KEY?.[k]`, `await KEY`, `[KEY, ...list]`, `{ [k]: KEY }`, a class static
 * block, a `for (var x of read(KEY)) …` loop, and the esbuild lowerings that
 * are calls by the time this pass sees them: `using`/`await using` become
 * `__using(stack, KEY)`, a TypeScript `enum` or `namespace` becomes an
 * immediately invoked function, and a decorator becomes a call evaluated where
 * the class is defined. Each of those reads the binding at module load, so
 * dropping it would change what the module does. It is also not a dead-code
 * eliminator: an unreachable declaration that holds nothing server-only stays
 * where it is. Nor does it model `eval`. It is not a general guarantee that
 * every secret stays on the server, but a value used solely by a server-only
 * hook no longer leaks.
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
const __vfStubInit = function () { throw new Error("server-only"); };
function __vfStubEmpty() {}`;

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

function nodeStart(node: Node): number | null {
  return typeof node.start === "number" ? node.start : null;
}

function nodeEnd(node: Node): number | null {
  return typeof node.end === "number" ? node.end : null;
}

/**
 * The name an export clause publishes. Usually an identifier, but ES2022 also
 * allows a string literal (`export { loadIt as "getServerData" }`), which the
 * runtime looks the hook up under just the same.
 */
function exportedName(value: unknown): string | null {
  const identifier = nodeName(value);
  if (identifier !== null) return identifier;
  if (!isNode(value)) return null;
  return typeof value.value === "string" ? value.value : null;
}

function bodyOf(ast: ASTNode): Node[] {
  const program = (ast as { program?: unknown }).program;
  const source: Node = isNode(program) ? program : ast;
  const body = source.body;
  return Array.isArray(body) ? body.filter(isNode) : [];
}

function isRuntimeTsModuleDeclaration(node: Node): boolean {
  return node.type === "TSModuleDeclaration" && node.declare !== true &&
    node.global !== true && nodeName(node.id) !== null;
}

function isRuntimeTsImportEqualsDeclaration(node: Node): boolean {
  return node.type === "TSImportEqualsDeclaration" && node.importKind !== "type";
}

/** The stub nodes this pass splices in, parsed rather than constructed. */
interface Stubs {
  /** Hook function body: `{ throw new Error("server-only") }`. */
  body: Node;
  /** Hook initialiser: `function () { throw new Error("server-only") }`. */
  init: Node;
  /** Empty block, for a statement slot a dropped `var` declaration leaves bare. */
  empty: Node;
}

async function parseStubs(parser: CodeParser): Promise<Stubs | null> {
  const ast = await parser.parse({ code: STUB_SOURCE, filePath: "vf-stub.ts" });
  const [fn, variable, emptyFn] = bodyOf(ast);

  const body = fn?.body;
  const empty = emptyFn?.body;
  const declarations = variable?.declarations;
  const init = Array.isArray(declarations) && isNode(declarations[0])
    ? (declarations[0] as Node).init
    : undefined;

  if (!isNode(body) || !isNode(init) || !isNode(empty)) return null;
  return { body, init, empty };
}

/** The declarators of a variable declaration, as nodes. */
function declaratorsOf(declaration: Node): Node[] {
  return Array.isArray(declaration.declarations) ? declaration.declarations.filter(isNode) : [];
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
    if (statement.exportKind === "type") continue;

    // `export * as getServerData from "./loader"` names a hook without binding
    // anything locally, so there is no declaration to stub and the loader
    // module stays in the browser graph.
    if (statement.type === "ExportAllDeclaration") {
      const exported = exportedName(statement.exported);
      if (isHook(exported)) unhandled.push(`export * as ${exported} from …`);
      continue;
    }

    if (statement.type !== "ExportNamedDeclaration") continue;

    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      if (!isNode(specifier)) continue;
      if (specifier.exportKind === "type") continue;
      const exported = exportedName(specifier.exported);
      if (!isHook(exported)) continue;

      // `export { x as getServerData } from "./loader"` never binds `x` here,
      // so there is no body to empty and the module it points at is still
      // pulled into the graph.
      if (isNode(statement.source)) {
        unhandled.push(`export { … as ${exported} } from …`);
        continue;
      }

      // ES2022 arbitrary module namespace name: `export { loadIt as
      // "getServerData" }`. The runtime still looks the hook up under that
      // string, but the export clause is a form this pass does not rewrite, so
      // it stops the build rather than passing the module through untouched.
      // In the browser pipeline esbuild has already normalised this to a plain
      // identifier export by the time the stage runs, so this branch guards
      // direct callers of `stripServerOnlyExports` rather than that path.
      if (nodeName(specifier.exported) === null) {
        unhandled.push(`export { … as "${exported}" }`);
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
  stubs: Stubs,
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

/**
 * Identifiers the module reads, excluding imports, fixed property names, and
 * TypeScript syntax erased before runtime.
 */
function referencedIdentifiers(body: Node[], excluded?: WeakSet<Node>): Set<string> {
  const referenced = new Set<string>();
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
          candidate.type === "Identifier" && localNames.has(nodeName(candidate) ?? "")
        ) fixedNames.add(candidate);
      });
    }
  };

  for (const statement of body) {
    if (statement.type === "ImportDeclaration") continue;
    walk(statement, (node) => {
      if (node.type === "ImportDeclaration") return false;
      if (isErasedTypeNode(node)) return false;
      markEnumLocalReferences(node);
      markFixedName(node);
      if (node.type === "Identifier" || node.type === "JSXIdentifier") {
        if (fixedNames.has(node) || excluded?.has(node)) return true;
        const name = nodeName(node);
        if (name) referenced.add(name);
      }
      return true;
    });
  }

  return referenced;
}

/**
 * One place a module-scope binding is written down: a node of the binding
 * graph, together with the way to take it back out of the tree.
 *
 * A destructuring declarator (`const { apiKey } = getEnv(...)`) is a single
 * site carrying every name its pattern binds: it is removed only when *all* of
 * them are dead, so a pattern the client still partly reads survives whole.
 * This is what stops a destructured server value from shipping: esbuild's
 * tree-shaker never removes a destructuring of a call, even a
 * `@__PURE__`-annotated one, because the pattern itself may trigger getters or
 * throw.
 */
interface BindingSite {
  /** Every name this site binds. */
  names: string[];
  /** What the site's own code reads, its outgoing edges in the graph. */
  references: Set<string>;
  /** The node to elide when asking what the rest of the module still reads. */
  node: Node;
  /** Exported sites are part of the module's contract and are never removed. */
  exported: boolean;
  /** Whether a `var` site was hoisted out of nested control flow. */
  nested: boolean;
  /** Whether the binding exists initialized before module evaluation starts. */
  initialization: "instantiation" | "evaluation";
  /** Takes the site out of the tree, or `null` when the form has no safe cut. */
  remove: (() => void) | null;
}

/** The names a declarator binds, or `null` when the pattern is unanalysable. */
function declaratorBoundNames(declarator: Node): string[] | null {
  const id = declarator.id;
  if (!isNode(id)) return null;

  const bindingIds = id.type === "Identifier" ? [id] : patternBindingIdentifiers(id);
  const names: string[] = [];
  for (const bindingId of bindingIds) {
    const name = nodeName(bindingId);
    if (name) names.push(name);
  }
  // A pattern with an unnameable binding cannot be reasoned about; a pattern
  // binding nothing (`const {} = …`) has no dead name to chase. Either way the
  // declarator simply stays.
  if (names.length === 0 || names.length !== bindingIds.length) return null;
  return names;
}

/**
 * What a single declarator reads. Asking `freeReferencedIdentifiers` about a
 * one-declarator declaration rather than the declarator node keeps the pattern
 * in binding position: a default that reads a *sibling* of the same pattern
 * (`const { token, auth = token } = …`) is bound, not free, so it never counts
 * as an outside consumer of the declaration it lives in.
 */
function declaratorReferences(declaration: Node, declarator: Node): Set<string> {
  return freeReferencedIdentifiers({
    type: "VariableDeclaration",
    kind: declaration.kind,
    declarations: [declarator],
  });
}

/**
 * Every module-scope binding, as graph nodes.
 *
 * Top-level declarations are the obvious ones, but a `var` hoists out of any
 * block, `if`, `try`, `switch`, loop or label it is written in, so those bind
 * module scope too and belong in the graph. The pass used to miss them
 * entirely, which made a secret declared as `if (cond) { var KEY = getEnv(…) }`
 * permanently unremovable. Function bodies and class static blocks are separate
 * `var` scopes and are not entered.
 *
 * `removeStatement` collects top-level statements the caller should filter out;
 * deeper sites carry a closure that edits the tree in place.
 */
function moduleScopeBindingSites(
  body: Node[],
  stubs: Stubs,
  removeStatement: (statement: Node) => void,
): BindingSite[] {
  const sites: BindingSite[] = [];

  const addDeclarators = (
    declaration: Node,
    exported: boolean,
    detach: (() => void) | null,
    nested = false,
  ): void => {
    for (const declarator of declaratorsOf(declaration)) {
      const names = declaratorBoundNames(declarator);
      if (!names) continue;

      sites.push({
        names,
        references: declaratorReferences(declaration, declarator),
        node: declarator,
        exported,
        nested,
        initialization: declaration.kind === "var" ? "instantiation" : "evaluation",
        remove: detach === null ? null : () => {
          declaration.declarations = declaratorsOf(declaration).filter((candidate) =>
            candidate !== declarator
          );
          if (declaratorsOf(declaration).length === 0) detach();
        },
      });
    }
  };

  for (const statement of body) {
    if (statement.type === "ImportDeclaration") continue;

    const exported = statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration" ||
      (isRuntimeTsImportEqualsDeclaration(statement) && statement.isExport === true);
    const declaration = statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration"
      ? statement.declaration
      : statement;
    if (!isNode(declaration)) continue;

    if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
      const name = nodeName(declaration.id);
      if (name) {
        sites.push({
          names: [name],
          references: freeReferencedIdentifiers(declaration),
          node: statement,
          exported,
          nested: false,
          initialization: declaration.type === "FunctionDeclaration"
            ? "instantiation"
            : "evaluation",
          remove: exported ? null : () => removeStatement(statement),
        });
      }
    } else if (
      (declaration.type === "TSEnumDeclaration" && declaration.declare !== true) ||
      isRuntimeTsModuleDeclaration(declaration) ||
      isRuntimeTsImportEqualsDeclaration(declaration)
    ) {
      const name = nodeName(declaration.id);
      if (name) {
        sites.push({
          names: [name],
          references: freeReferencedIdentifiers(declaration),
          node: statement,
          exported,
          nested: false,
          initialization: "evaluation",
          remove: exported ? null : () => removeStatement(statement),
        });
      }
    } else if (declaration.type === "VariableDeclaration") {
      addDeclarators(declaration, exported, exported ? null : () => removeStatement(statement));
    }

    collectHoistedVarSites(
      declaration,
      stubs,
      (nestedDeclaration, nestedExported, detach) =>
        addDeclarators(nestedDeclaration, nestedExported, detach, true),
    );
  }

  return sites;
}

/** Constructs that open a fresh `var` scope, so a `var` inside stops here. */
function startsVarScope(node: Node): boolean {
  return node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" || node.type === "ObjectMethod" ||
    node.type === "ClassMethod" || node.type === "ClassDeclaration" ||
    node.type === "ClassExpression" || node.type === "StaticBlock" ||
    node.type.startsWith("TS");
}

/**
 * `var` declarations *below* a top-level statement, which hoist into module
 * scope all the same. Each is registered with the edit that removes it: an
 * element of a statement list is filtered out, a statement slot
 * (`label: var KEY = …`, `if (c) var KEY = …`) becomes an empty block, and a
 * `for` initialiser is cleared.
 *
 * A `for…in`/`for…of` head has no such edit, because the binding is what the
 * loop assigns to, so those sites are registered as unremovable and the caller
 * fails the build rather than shipping the value they hold.
 */
function collectHoistedVarSites(
  root: Node,
  stubs: Stubs,
  add: (declaration: Node, exported: boolean, detach: (() => void) | null) => void,
): void {
  if (startsVarScope(root)) return;

  const slotDetach = (owner: Node, key: string): (() => void) | null => {
    if (key === "body" || key === "consequent" || key === "alternate") {
      return () => {
        owner[key] = structuredClone(stubs.empty);
      };
    }
    if (key === "init" && owner.type === "ForStatement") {
      return () => {
        owner[key] = null;
      };
    }
    return null;
  };

  const descend = (node: Node): void => {
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;

      if (Array.isArray(value)) {
        for (const entry of value) {
          if (!isNode(entry) || startsVarScope(entry)) continue;
          visitChild(entry, () => {
            node[key] = (node[key] as unknown[]).filter((candidate) => candidate !== entry);
          });
        }
        continue;
      }

      if (!isNode(value) || startsVarScope(value)) continue;
      visitChild(value, slotDetach(node, key));
    }
  };

  const visitChild = (child: Node, detach: (() => void) | null): void => {
    if (child.type === "VariableDeclaration" && child.kind === "var") {
      add(child, false, detach);
    }
    descend(child);
  };

  descend(root);
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
      declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration" ||
      (declaration.type === "TSEnumDeclaration" && declaration.declare !== true) ||
      isRuntimeTsModuleDeclaration(declaration) ||
      isRuntimeTsImportEqualsDeclaration(declaration)
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

const NOTHING_ELIDED: ReadonlySet<Node> = new Set<Node>();

/**
 * Free identifiers genuinely *read* by a subtree, the edges of the
 * module-scope binding graph.
 *
 * Scope-aware: a nested declaration that shadows `loadJob` must not hide a real
 * outer hook read of the imported `loadJob`, and a nested local inside a pruned
 * helper must not add an unrelated import to the hook closure.
 *
 * Position-aware too, because several identifier positions are not reads and
 * counting them keeps server state alive forever: a statement label
 * (`KEY: for (…) { break KEY }`), the *exported* half of an export specifier
 * (`export { other as KEY }`), a non-computed property or JSX attribute name,
 * and the `import.meta` meta-property all spell a name without reading the
 * binding it happens to match.
 *
 * `elided` names declaration nodes to treat as already deleted: their bindings
 * are not introduced and their own reads are not collected, so the result is
 * exactly what the *rest* of the module still reads. That is how a candidate
 * for removal stops masking the reads of the code around it.
 *
 * `deferred` names functions, methods and instance fields whose bodies do not
 * run where they are written. Their reads are still reads: they are just not
 * reads the *module evaluation* performs, which is the difference between the
 * roots of the liveness walk and the edges of it.
 */
function freeReferencedIdentifiers(
  root: Node,
  elided: ReadonlySet<Node> = NOTHING_ELIDED,
  deferred: ReadonlySet<Node> = NOTHING_ELIDED,
): Set<string> {
  const free = new Set<string>();
  const rootScope: LexicalScope = { kind: "var", names: new Set() };

  const currentVarScope = (scopes: LexicalScope[]): LexicalScope =>
    scopes.find((scope) => scope.kind === "var") ?? scopes[0] ?? rootScope;

  const bindPatternNames = (scope: LexicalScope, value: unknown): void => {
    if (!isNode(value)) return;
    for (const name of patternBoundNames(value)) scope.names.add(name);
  };

  const addFreeName = (name: string | null, scopes: LexicalScope[]): void => {
    if (name && !isLexicallyBound(name, scopes)) free.add(name);
  };

  const isIntrinsicJsxTagName = (name: string): boolean => {
    const first = name.charCodeAt(0);
    return (first >= 97 && first <= 122) || name.includes("-");
  };

  const bindDirectStatements = (scope: LexicalScope, statements: unknown[]): void => {
    for (const statement of statements) {
      if (!isNode(statement) || elided.has(statement)) continue;
      const declaration = statement.type === "ExportNamedDeclaration" ||
          statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
      if (!isNode(declaration)) continue;
      if (
        declaration.type === "FunctionDeclaration" ||
        declaration.type === "ClassDeclaration" ||
        declaration.type === "TSEnumDeclaration" ||
        isRuntimeTsModuleDeclaration(declaration) ||
        isRuntimeTsImportEqualsDeclaration(declaration)
      ) {
        bindPatternNames(scope, declaration.id);
        continue;
      }
      if (declaration.type !== "VariableDeclaration") continue;
      for (const declarator of declaratorsOf(declaration)) {
        if (!elided.has(declarator)) bindPatternNames(scope, declarator.id);
      }
    }
  };

  const bindDirectDeclarations = (scope: LexicalScope, node: Node): void => {
    const body = node.body;
    if (Array.isArray(body)) bindDirectStatements(scope, body);
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
        for (const declarator of declaratorsOf(child)) {
          if (!elided.has(declarator)) bindPatternNames(scope, declarator.id);
        }
      }
      bindNestedVarDeclarations(scope, child);
    }
  };

  const visitChildren = (node: Node, scopes: LexicalScope[]): void => {
    for (const child of children(node)) visit(child, scopes);
  };

  const visitPatternRuntime = (
    pattern: Node,
    scopes: LexicalScope[],
    decoratorScopes: LexicalScope[] = scopes,
  ): void => {
    if (deferred.has(pattern)) {
      visitPatternDecorators(pattern, decoratorScopes);
      return;
    }
    // Babel hangs a parameter decorator off the pattern itself (a plain
    // `Identifier`, an `AssignmentPattern` or a destructuring pattern) and not
    // only off a `TSParameterProperty`. A decorator is ordinary runtime code
    // whose reads count, so `constructor(@inject(loadSecret) value: string)`
    // keeps the import it needs; missing it dropped that import out from under
    // the surviving client declaration. esbuild either rejects a parameter
    // decorator or lowers it away before the browser pipeline reaches this
    // stage, so this is defence in depth for direct callers and for any parser
    // that hands over an untransformed tree, not a path the pipeline walks.
    visitDecorators(pattern, decoratorScopes);

    if (pattern.type === "TSParameterProperty") {
      if (isNode(pattern.parameter)) {
        visitPatternRuntime(pattern.parameter, scopes, decoratorScopes);
      }
      return;
    }

    if (pattern.type === "Identifier") return;

    if (pattern.type === "AssignmentPattern") {
      if (isNode(pattern.left)) visitPatternRuntime(pattern.left, scopes, decoratorScopes);
      if (isNode(pattern.right)) visit(pattern.right, scopes);
      return;
    }

    if (pattern.type === "RestElement") {
      if (isNode(pattern.argument)) {
        visitPatternRuntime(pattern.argument, scopes, decoratorScopes);
      }
      return;
    }

    if (pattern.type === "ArrayPattern") {
      for (const element of Array.isArray(pattern.elements) ? pattern.elements : []) {
        if (isNode(element)) visitPatternRuntime(element, scopes, decoratorScopes);
      }
      return;
    }

    if (pattern.type === "ObjectPattern") {
      for (const property of Array.isArray(pattern.properties) ? pattern.properties : []) {
        if (!isNode(property)) continue;
        if (deferred.has(property)) continue;
        if (property.type === "RestElement") {
          if (isNode(property.argument)) {
            visitPatternRuntime(property.argument, scopes, decoratorScopes);
          }
          continue;
        }
        if (property.type !== "ObjectProperty") {
          visit(property, scopes);
          continue;
        }
        if (property.computed === true && isNode(property.key)) visit(property.key, scopes);
        if (isNode(property.value)) {
          visitPatternRuntime(property.value, scopes, decoratorScopes);
        }
      }
      return;
    }

    visit(pattern, scopes);
  };

  const visitPatternDecorators = (
    pattern: Node,
    decoratorScopes: LexicalScope[],
  ): void => {
    visitDecorators(pattern, decoratorScopes);

    if (pattern.type === "TSParameterProperty" && isNode(pattern.parameter)) {
      visitPatternDecorators(pattern.parameter, decoratorScopes);
      return;
    }
    if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
      visitPatternDecorators(pattern.left, decoratorScopes);
      return;
    }
    if (pattern.type === "RestElement" && isNode(pattern.argument)) {
      visitPatternDecorators(pattern.argument, decoratorScopes);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of Array.isArray(pattern.elements) ? pattern.elements : []) {
        if (isNode(element)) visitPatternDecorators(element, decoratorScopes);
      }
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of Array.isArray(pattern.properties) ? pattern.properties : []) {
        if (!isNode(property)) continue;
        if (property.type === "RestElement" && isNode(property.argument)) {
          visitPatternDecorators(property.argument, decoratorScopes);
        } else if (property.type === "ObjectProperty" && isNode(property.value)) {
          visitPatternDecorators(property.value, decoratorScopes);
        }
      }
    }
  };

  const bindVariableDeclaration = (node: Node, scopes: LexicalScope[]): void => {
    const targetScope = node.kind === "var" ? currentVarScope(scopes) : scopes[0] ?? rootScope;
    for (const declarator of declaratorsOf(node)) {
      if (!elided.has(declarator)) bindPatternNames(targetScope, declarator.id);
    }
  };

  const visitVariableDeclaration = (node: Node, scopes: LexicalScope[]): void => {
    bindVariableDeclaration(node, scopes);
    for (const declarator of declaratorsOf(node)) {
      if (elided.has(declarator) || deferred.has(declarator)) continue;
      if (isNode(declarator.id)) visitPatternRuntime(declarator.id, scopes);
      if (isNode(declarator.init)) visit(declarator.init, scopes);
    }
  };

  const visitFunction = (node: Node, scopes: LexicalScope[]): void => {
    const functionScope: LexicalScope = { kind: "var", names: new Set() };
    const isDeferred = deferred.has(node);
    if (node.type === "FunctionDeclaration") bindPatternNames(scopes[0] ?? rootScope, node.id);
    bindPatternNames(functionScope, node.id);

    for (const param of Array.isArray(node.params) ? node.params : []) {
      if (isNode(param)) bindPatternNames(functionScope, param);
    }
    for (const param of Array.isArray(node.params) ? node.params : []) {
      if (isNode(param)) {
        if (isDeferred || deferred.has(param)) visitPatternDecorators(param, scopes);
        else visitPatternRuntime(param, [functionScope, ...scopes], scopes);
      }
    }

    if (isDeferred) return;
    if (isNode(node.body) && deferred.has(node.body)) return;

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

  // A decorator is ordinary code in an easily missed position: `@withKey(KEY)`
  // reads `KEY` just as a call in an initialiser would. Classes, their members
  // and TypeScript parameter properties can all carry one.
  const visitDecorators = (node: Node, scopes: LexicalScope[]): void => {
    for (const decorator of Array.isArray(node.decorators) ? node.decorators : []) {
      if (isNode(decorator)) visit(decorator, scopes);
    }
  };

  const visitObjectMember = (node: Node, scopes: LexicalScope[]): void => {
    visitDecorators(node, scopes);
    if (node.computed === true && isNode(node.key)) visit(node.key, scopes);
    if (deferred.has(node)) return;
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

    if (node.type === "TSExportAssignment") {
      if (isNode(node.expression)) visit(node.expression, scopes);
      return true;
    }

    if (node.type.startsWith("TS")) return true;
    return false;
  };

  const visitTsEnum = (node: Node, scopes: LexicalScope[]): void => {
    bindPatternNames(scopes[0] ?? rootScope, node.id);

    const enumScope: LexicalScope = { kind: "block", names: new Set() };
    bindPatternNames(enumScope, node.id);
    for (const member of Array.isArray(node.members) ? node.members : []) {
      if (isNode(member) && isNode(member.id) && member.id.type === "Identifier") {
        bindPatternNames(enumScope, member.id);
      }
    }

    const enumScopes = [enumScope, ...scopes];
    for (const member of Array.isArray(node.members) ? node.members : []) {
      if (isNode(member) && isNode(member.initializer)) {
        visit(member.initializer, enumScopes);
      }
    }
  };

  const visitTsModule = (node: Node, scopes: LexicalScope[]): void => {
    if (!isRuntimeTsModuleDeclaration(node)) return;

    bindPatternNames(scopes[0] ?? rootScope, node.id);
    const moduleScope: LexicalScope = { kind: "var", names: new Set() };
    bindPatternNames(moduleScope, node.id);
    const moduleScopes = [moduleScope, ...scopes];

    const body = node.body;
    if (!isNode(body)) return;
    if (body.type === "TSModuleBlock") {
      bindDirectDeclarations(moduleScope, body);
      bindNestedVarDeclarations(moduleScope, body);
      for (const statement of Array.isArray(body.body) ? body.body : []) {
        if (isNode(statement)) visit(statement, moduleScopes);
      }
      return;
    }
    if (body.type === "TSModuleDeclaration") visitTsModule(body, moduleScopes);
  };

  const visitTsEntityName = (node: Node, scopes: LexicalScope[]): void => {
    if (node.type === "TSQualifiedName" && isNode(node.left)) {
      visitTsEntityName(node.left, scopes);
      return;
    }
    if (node.type === "Identifier") visit(node, scopes);
  };

  const visitTsImportEquals = (node: Node, scopes: LexicalScope[]): void => {
    if (!isRuntimeTsImportEqualsDeclaration(node)) return;
    bindPatternNames(scopes[0] ?? rootScope, node.id);
    if (isNode(node.moduleReference)) visitTsEntityName(node.moduleReference, scopes);
  };

  const visit = (node: Node, scopes: LexicalScope[]): void => {
    if (node.type === "ImportDeclaration" || elided.has(node)) return;
    if (isErasedTypeNode(node)) return;
    const handlesDeferredNode = node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" || node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod" || node.type === "ObjectProperty" ||
      node.type === "ClassProperty" || node.type === "ClassPrivateProperty" ||
      node.type === "ClassAccessorProperty" || node.type === "StaticBlock";
    if (deferred.has(node) && !handlesDeferredNode) return;
    if (node.type === "TSEnumDeclaration") {
      visitTsEnum(node, scopes);
      return;
    }
    if (node.type === "TSModuleDeclaration") {
      visitTsModule(node, scopes);
      return;
    }
    if (node.type === "TSImportEqualsDeclaration") {
      visitTsImportEquals(node, scopes);
      return;
    }
    if (visitTsExpression(node, scopes)) return;

    if (node.type === "Identifier") {
      addFreeName(nodeName(node), scopes);
      return;
    }

    if (node.type === "JSXIdentifier") {
      const name = nodeName(node);
      if (name && !isIntrinsicJsxTagName(name)) addFreeName(name, scopes);
      return;
    }

    // A statement label lives in its own namespace: `break KEY` does not read
    // the module's `KEY`.
    if (node.type === "LabeledStatement") {
      if (isNode(node.body)) visit(node.body, scopes);
      return;
    }
    if (node.type === "BreakStatement" || node.type === "ContinueStatement") return;

    // `export { other as KEY }` reads `other` and publishes the *name* `KEY`.
    // A re-export (`export … from "./x"`) reads nothing declared here at all.
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      if (isNode(node.source)) return;
      visitChildren(node, scopes);
      return;
    }
    if (node.type === "ExportSpecifier") {
      if (isNode(node.local)) visit(node.local, scopes);
      return;
    }
    if (node.type === "ExportDefaultSpecifier" || node.type === "ExportNamespaceSpecifier") return;

    // `import.meta` spells `import` and `meta`, and reads neither.
    if (node.type === "MetaProperty") return;
    if (node.type === "PrivateName") return;

    if (node.type === "JSXAttribute") {
      if (isNode(node.value)) visit(node.value, scopes);
      return;
    }
    if (node.type === "JSXMemberExpression") {
      let object = node.object;
      while (isNode(object) && object.type === "JSXMemberExpression") object = object.object;
      if (isNode(object)) {
        if (object.type === "JSXIdentifier") addFreeName(nodeName(object), scopes);
        else visit(object, scopes);
      }
      return;
    }
    if (node.type === "JSXNamespacedName") return;

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
      if (deferred.has(node)) return;
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
      const namespaceScope: LexicalScope = { kind: "var", names: new Set() };
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
      const classScope: LexicalScope = { kind: "block", names: new Set() };
      bindPatternNames(classScope, node.id);
      const classScopes = [classScope, ...scopes];
      const body = node.body;
      // A class decorator is evaluated outside the class, so it does not see
      // the class binding.
      visitDecorators(node, scopes);
      if (isNode(node.superClass)) visit(node.superClass, classScopes);
      if (isNode(body)) visitChildren(body, classScopes);
      return;
    }

    if (node.type === "CatchClause") {
      const scope: LexicalScope = { kind: "block", names: new Set() };
      if (isNode(node.param)) {
        bindPatternNames(scope, node.param);
        visitPatternRuntime(node.param, [scope, ...scopes]);
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
      node.type === "ClassPrivateProperty" || node.type === "ClassAccessorProperty"
    ) {
      visitObjectMember(node, scopes);
      return;
    }

    if (
      node.type === "ObjectMethod" || node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
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

/** Reference-walker answers exposed for TypeScript classification tests. */
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

/**
 * Identifiers referenced inside the server-only hooks that are about to be
 * emptied, the seed of the hook's dependency closure. Must be collected before
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
 * at module-evaluation time. Collection is deliberately scope-blind: a nested
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
 * Traversal stops at every construct that starts a new `var` scope (function
 * bodies, class bodies, class static blocks and TypeScript-only nodes), so a
 * nested `function Page() { var getServerData = 1 }` is a local of `Page` and
 * is not reported.
 */
function hoistedVarNames(body: Node[]): Set<string> {
  const hoisted = new Set<string>();

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

function compilerNameRegistrations(
  body: Node[],
  helpers: ReadonlySet<string>,
): CompilerNameRegistration[] {
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
 * Every name reachable from `roots` by following the binding graph's edges.
 *
 * A name is live when surviving code reads it, or when a live binding's own
 * code reads it. Everything else is dead, cycles included, which is exactly
 * what asking each declaration in turn "is this name mentioned anywhere else?"
 * can never see: two hook-only helpers that call each other keep each other
 * alive forever, and whatever they close over ships with them.
 */
function reachableNames(roots: Iterable<string>, sites: BindingSite[]): Set<string> {
  const byName = new Map<string, BindingSite[]>();
  for (const site of sites) {
    for (const name of site.names) {
      const bound = byName.get(name);
      if (bound) bound.push(site);
      else byName.set(name, [site]);
    }
  }

  const reachable = new Set(roots);
  const pending = [...reachable];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    for (const site of byName.get(name) ?? []) {
      for (const reference of site.references) {
        if (reachable.has(reference)) continue;
        reachable.add(reference);
        pending.push(reference);
      }
    }
  }

  return reachable;
}

/** Whether a node carries at least one decorator, which runs where it sits. */
function hasDecorators(node: Node): boolean {
  return Array.isArray(node.decorators) && node.decorators.length > 0;
}

function patternHasDecorators(pattern: Node): boolean {
  if (hasDecorators(pattern)) return true;
  if (pattern.type === "TSParameterProperty") {
    return isNode(pattern.parameter) && patternHasDecorators(pattern.parameter);
  }
  if (pattern.type === "AssignmentPattern") {
    return isNode(pattern.left) && patternHasDecorators(pattern.left);
  }
  if (pattern.type === "RestElement") {
    return isNode(pattern.argument) && patternHasDecorators(pattern.argument);
  }
  if (pattern.type === "ArrayPattern") {
    return (Array.isArray(pattern.elements) ? pattern.elements : []).some((element) =>
      isNode(element) && patternHasDecorators(element)
    );
  }
  if (pattern.type === "ObjectPattern") {
    return (Array.isArray(pattern.properties) ? pattern.properties : []).some((property) => {
      if (!isNode(property)) return false;
      if (property.type === "RestElement") {
        return isNode(property.argument) && patternHasDecorators(property.argument);
      }
      return property.type === "ObjectProperty" && isNode(property.value) &&
        patternHasDecorators(property.value);
    });
  }
  return false;
}

function hasParameterDecorators(node: Node): boolean {
  return (Array.isArray(node.params) ? node.params : []).some((param) =>
    isNode(param) && patternHasDecorators(param)
  );
}

/**
 * `__name(<value>, "name")` is esbuild's `keepNames` helper applied inline, the
 * shape a dev build wraps every initialiser in. It defines a `name` property on
 * the value it is handed and returns it, so it is compiler metadata rather than
 * a call the module makes, and it is exactly as inert as its first argument.
 */
function isNameRegistrationCall(node: Node, helpers: ReadonlySet<string>): boolean {
  if (node.type !== "CallExpression" || !isNode(node.callee)) return false;
  if (!helpers.has(nodeName(node.callee) ?? "")) return false;

  const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
  return args.length === 2 && stringLiteralText(args[1]) !== null;
}

/** `static { __name(this, "Loader") }`, the class form of that same metadata. */
function isNameRegistrationBlock(node: Node, helpers: ReadonlySet<string>): boolean {
  const statements = Array.isArray(node.body) ? node.body.filter(isNode) : [];
  return statements.every((statement) => {
    if (statement.type !== "ExpressionStatement" || !isNode(statement.expression)) return false;
    const call = statement.expression;
    if (!isNameRegistrationCall(call, helpers)) return false;
    const [target] = Array.isArray(call.arguments) ? call.arguments.filter(isNode) : [];
    return target?.type === "ThisExpression";
  });
}

/**
 * A class whose *definition* runs nothing: no decorator, no superclass, no
 * computed member key and no static initialiser. Method bodies and instance
 * field initialisers run at construction time, not at module load. Even
 * `extends Base` reads `Base.prototype`, which can invoke a Proxy trap, so a
 * heritage clause is never treated as inert here.
 */
function isInertClass(
  node: Node,
  helpers: ReadonlySet<string>,
  initializedNames: ReadonlySet<string>,
): boolean {
  if (hasDecorators(node) || isNode(node.superClass)) return false;

  const members = isNode(node.body) && Array.isArray(node.body.body) ? node.body.body : [];
  return members.every((member) => {
    if (!isNode(member)) return false;
    if (hasDecorators(member) || hasParameterDecorators(member) || member.computed === true) {
      return false;
    }
    if (member.type === "StaticBlock") return isNameRegistrationBlock(member, helpers);
    if (member.static !== true) return true;
    return isInertExpression(
      isNode(member.value) ? member.value : undefined,
      helpers,
      initializedNames,
    );
  });
}

/** Expressions whose evaluation cannot run user code. A whitelist, by design. */
function isInertExpression(
  node: Node | undefined,
  helpers: ReadonlySet<string>,
  initializedNames: ReadonlySet<string>,
): boolean {
  if (!node) return true;

  const inner = (value: unknown): Node | undefined => isNode(value) ? value : undefined;

  switch (node.type) {
    case "Identifier":
      return initializedNames.has(nodeName(node) ?? "");
    case "ThisExpression":
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "BigIntLiteral":
    case "DecimalLiteral":
    case "RegExpLiteral":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return true;
    case "ClassExpression":
      return isInertClass(node, helpers, initializedNames);
    case "CallExpression":
      return isNameRegistrationCall(node, helpers) &&
        isInertExpression(inner((node.arguments as unknown[])[0]), helpers, initializedNames);
    // Interpolation coerces its values to strings, which calls `toString`.
    case "TemplateLiteral":
      return !Array.isArray(node.expressions) || node.expressions.length === 0;
    // `typeof`, `void` and `!` are the operators that never reach `valueOf`;
    // `-x` and `+x` do, and `delete` mutates.
    case "UnaryExpression":
      return (node.operator === "typeof" || node.operator === "void" ||
        node.operator === "!") &&
        isInertExpression(inner(node.argument), helpers, initializedNames);
    // Testing a value for truthiness and yielding one of two operands calls
    // nothing, however the choice is spelled.
    case "ConditionalExpression":
      return isInertExpression(inner(node.test), helpers, initializedNames) &&
        isInertExpression(inner(node.consequent), helpers, initializedNames) &&
        isInertExpression(inner(node.alternate), helpers, initializedNames);
    case "LogicalExpression":
      return isInertExpression(inner(node.left), helpers, initializedNames) &&
        isInertExpression(inner(node.right), helpers, initializedNames);
    // Only the two comparisons that never coerce. `==` and the relational and
    // arithmetic operators all reach `valueOf`/`toString`, `instanceof` calls
    // `Symbol.hasInstance` and `in` traps on a proxy.
    case "BinaryExpression":
      return (node.operator === "===" || node.operator === "!==") &&
        isInertExpression(inner(node.left), helpers, initializedNames) &&
        isInertExpression(inner(node.right), helpers, initializedNames);
    // `(a, b)` evaluates each operand in turn and yields the last.
    case "SequenceExpression":
      return (Array.isArray(node.expressions) ? node.expressions : []).every((expression) =>
        isNode(expression) && isInertExpression(expression, helpers, initializedNames)
      );
    case "ArrayExpression":
      return (Array.isArray(node.elements) ? node.elements : []).every((element) =>
        element === null || element === undefined ||
        (isNode(element) && element.type !== "SpreadElement" &&
          isInertExpression(element, helpers, initializedNames))
      );
    case "ObjectExpression":
      return (Array.isArray(node.properties) ? node.properties : []).every((property) => {
        // A spread iterates its source and a computed key is coerced to a
        // property key; both run user code. Defining a method does not.
        if (!isNode(property) || property.computed === true) return false;
        if (property.type === "ObjectMethod") return true;
        return property.type === "ObjectProperty" &&
          isInertExpression(inner(property.value), helpers, initializedNames);
      });
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "TSInstantiationExpression":
    case "ParenthesizedExpression":
      return isInertExpression(inner(node.expression), helpers, initializedNames);
    default:
      return false;
  }
}

/**
 * Whether a declaration *runs* when the module is evaluated.
 *
 * This is the line between the two halves of an unused declaration. One that
 * only introduces a name (a function, a `var dead = helper`, a class with no
 * decorator, superclass or static initialiser) does nothing at module-load
 * time, so an unreachable one is not surviving code and has no business being
 * asked what the module still reads. One whose initialiser runs
 * (`const clientInit = bootClientAnalytics()`) is a top-level side effect
 * wearing a binding: it survives, and it keeps whatever it references exactly
 * as the bare `registerClientHandler(…)` statement beside it would.
 *
 * Anything not proven inert counts as a side effect, which keeps its reads.
 */
function evaluationIsInert(
  node: Node,
  helpers: ReadonlySet<string>,
  initializedNames: ReadonlySet<string>,
): boolean {
  if (node.type === "FunctionDeclaration") return true;
  if (node.type === "ClassDeclaration") return isInertClass(node, helpers, initializedNames);
  // A runtime enum, namespace or import-equals evaluates a body at module load.
  if (node.type !== "VariableDeclarator") return false;

  // A destructuring pattern reads properties off the initialiser, which runs
  // getters and throws on `null`, so only a plain identifier binding is inert.
  if (!isNode(node.id) || node.id.type !== "Identifier") return false;
  return isInertExpression(
    isNode(node.init) ? node.init : undefined,
    helpers,
    initializedNames,
  );
}

/**
 * The parts of a declaration that do not run where they are written: function,
 * arrow and method bodies, and instance field initialisers, which run when
 * something calls or constructs them.
 *
 * This is what separates a declaration's *roots* from its *edges*. `const
 * handler = memo(() => KEY)` performs one read at module load (`memo`), and
 * the arrow body's read of `KEY` happens only if something calls the arrow,
 * which needs `handler`. Counting the whole subtree as module-evaluation reads
 * let any dead declaration with an impure initialiser vouch for every name
 * mentioned anywhere beneath it, secrets in never-run callbacks included.
 *
 * An immediately invoked function is not deferred: `(function () { … })()` runs
 * its body exactly where it sits, as does esbuild's lowering of a TypeScript
 * enum or namespace.
 */
function deferredExecutionNodes(root: Node, sites: BindingSite[]): Set<Node> {
  const deferred = new Set<Node>();
  const executedNodes = new Set<Node>();
  const constructedClasses = new Set<Node>();

  type ExecutionBindingInitialization = "instantiation" | "evaluation" | "unknown";
  type ExecutionScope = Map<
    string,
    Array<{ initialization: ExecutionBindingInitialization; node: Node }>
  >;

  const addExecutionBinding = (
    scope: ExecutionScope,
    value: unknown,
    initialization: ExecutionBindingInitialization,
    declaration: Node,
  ): void => {
    if (!isNode(value)) return;
    for (const name of patternBoundNames(value)) {
      const bindings = scope.get(name) ?? [];
      bindings.push({ initialization, node: declaration });
      scope.set(name, bindings);
    }
  };

  const addDirectExecutionBindings = (scope: ExecutionScope, statements: unknown[]): void => {
    for (const statement of statements) {
      if (!isNode(statement)) continue;
      const declaration = statement.type === "ExportNamedDeclaration" ||
          statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
      if (!isNode(declaration)) continue;
      if (declaration.type === "FunctionDeclaration") {
        addExecutionBinding(scope, declaration.id, "instantiation", declaration);
      } else if (
        declaration.type === "ClassDeclaration" || declaration.type === "TSEnumDeclaration" ||
        isRuntimeTsModuleDeclaration(declaration) ||
        isRuntimeTsImportEqualsDeclaration(declaration)
      ) {
        addExecutionBinding(scope, declaration.id, "evaluation", declaration);
      } else if (declaration.type === "VariableDeclaration" && declaration.kind !== "var") {
        for (const declarator of declaratorsOf(declaration)) {
          addExecutionBinding(scope, declarator.id, "evaluation", declarator);
        }
      }
    }
  };

  const addFunctionVarBindings = (scope: ExecutionScope, root: Node): void => {
    const collect = (node: Node): void => {
      for (const child of children(node)) {
        if (
          child.type === "FunctionDeclaration" || child.type === "FunctionExpression" ||
          child.type === "ArrowFunctionExpression" || child.type === "ObjectMethod" ||
          child.type === "ClassMethod" || child.type === "ClassPrivateMethod" ||
          child.type === "ClassDeclaration" || child.type === "ClassExpression" ||
          child.type === "StaticBlock" || child.type === "TSModuleDeclaration"
        ) continue;
        if (child.type === "VariableDeclaration" && child.kind === "var") {
          for (const declarator of declaratorsOf(child)) {
            addExecutionBinding(scope, declarator.id, "instantiation", declarator);
          }
        }
        collect(child);
      }
    };
    collect(root);
  };

  const executionScopeFor = (node: Node): ExecutionScope | null => {
    const scope: ExecutionScope = new Map();
    if (
      node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" || node.type === "ObjectMethod" ||
      node.type === "ClassMethod" || node.type === "ClassPrivateMethod"
    ) {
      addExecutionBinding(scope, node.id, "instantiation", node);
      for (const parameter of Array.isArray(node.params) ? node.params : []) {
        addExecutionBinding(scope, parameter, "unknown", node);
      }
      if (isNode(node.body)) addFunctionVarBindings(scope, node.body);
      return scope;
    }
    if (node.type === "BlockStatement") {
      addDirectExecutionBindings(scope, Array.isArray(node.body) ? node.body : []);
      return scope;
    }
    if (node.type === "CatchClause") {
      addExecutionBinding(scope, node.param, "instantiation", node);
      return scope;
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      addExecutionBinding(scope, node.id, "unknown", node);
      return scope;
    }
    if (
      (node.type === "ForStatement" || node.type === "ForInStatement" ||
        node.type === "ForOfStatement")
    ) {
      const declaration = node.init ?? node.left;
      if (
        isNode(declaration) && declaration.type === "VariableDeclaration" &&
        declaration.kind !== "var"
      ) {
        const initializationNode =
          (node.type === "ForInStatement" || node.type === "ForOfStatement") &&
            isNode(node.right)
            ? node.right
            : declaration;
        for (const declarator of declaratorsOf(declaration)) {
          addExecutionBinding(scope, declarator.id, "evaluation", initializationNode);
        }
      }
      return scope;
    }
    return null;
  };

  const initializedNamesAtCall = (
    node: Node,
    scopes: ExecutionScope[],
  ): Set<string> => {
    const initialized = initializedNamesBefore(node, sites);
    const callStart = nodeStart(node);
    for (const scope of [...scopes].reverse()) {
      for (const [name, bindings] of scope) {
        initialized.delete(name);
        const localIsInitialized = bindings.some((binding) => {
          if (binding.initialization === "instantiation") return true;
          const bindingEnd = nodeEnd(binding.node);
          return binding.initialization === "evaluation" && callStart !== null &&
            bindingEnd !== null && bindingEnd < callStart;
        });
        if (localIsInitialized) initialized.add(name);
      }
    }
    return initialized;
  };

  const withUnknownBindingsInitialized = (
    scope: ExecutionScope,
    names?: ReadonlySet<string>,
  ): ExecutionScope =>
    new Map(
      [...scope].map(([name, bindings]) => [
        name,
        bindings.map((binding) =>
          binding.initialization === "unknown" && (!names || names.has(name))
            ? { ...binding, initialization: "instantiation" as const }
            : binding
        ),
      ]),
    );

  const isInstanceField = (node: Node): boolean =>
    (node.type === "ClassProperty" || node.type === "ClassPrivateProperty" ||
      node.type === "ClassAccessorProperty") && node.static !== true;

  const isConstructor = (node: Node): boolean =>
    (node.type === "ClassMethod" || node.type === "ClassPrivateMethod") &&
    node.kind === "constructor";

  const explicitConstructor = (node: Node): Node | undefined =>
    isNode(node.body) && Array.isArray(node.body.body)
      ? node.body.body.find((member) => isNode(member) && isConstructor(member))
      : undefined;

  const noNameHelpers: ReadonlySet<string> = new Set<string>();
  const noInitializedNames: ReadonlySet<string> = new Set<string>();
  const inertCompletionExpression = (node: Node | undefined): boolean =>
    isInertExpression(node, noNameHelpers, noInitializedNames);

  const constructorBeginsWithCompletingSuper = (node: Node): boolean => {
    const constructor = explicitConstructor(node);
    if (!constructor || !isNode(constructor.body) || !Array.isArray(constructor.body.body)) {
      return false;
    }
    const first = constructor.body.body[0];
    if (!isNode(first) || first.type !== "ExpressionStatement" || !isNode(first.expression)) {
      return false;
    }
    const expression = first.expression;
    return expression.type === "CallExpression" && isNode(expression.callee) &&
      expression.callee.type === "Super" && Array.isArray(expression.arguments) &&
      expression.arguments.every((argument) =>
        isNode(argument) && inertCompletionExpression(argument)
      );
  };

  const unwrap = (node: Node): Node => {
    let current = node;
    while (
      (current.type === "ParenthesizedExpression" || current.type === "TSAsExpression" ||
        current.type === "TSTypeAssertion" || current.type === "TSNonNullExpression" ||
        current.type === "TSInstantiationExpression" ||
        current.type === "TSSatisfiesExpression") &&
      isNode(current.expression)
    ) {
      current = current.expression;
    }
    return current;
  };

  const functionConstructionCompletes = (node: Node): boolean =>
    node.type === "FunctionExpression" && node.async !== true && node.generator !== true &&
    Array.isArray(node.params) && node.params.length === 0 &&
    isNode(node.body) && node.body.type === "BlockStatement" &&
    Array.isArray(node.body.body) && node.body.body.length === 0;

  const invokesSuperclass = (node: Node): boolean =>
    isNode(node.superClass) &&
    (!explicitConstructor(node) || constructorBeginsWithCompletingSuper(node));

  const explicitConstructorCompletes = (node: Node): boolean => {
    const constructor = explicitConstructor(node);
    if (!constructor) return true;
    if (
      !Array.isArray(constructor.params) || constructor.params.length !== 0 ||
      !isNode(constructor.body) || !Array.isArray(constructor.body.body)
    ) return false;
    if (!isNode(node.superClass)) return constructor.body.body.length === 0;
    return constructor.body.body.length === 1 && constructorBeginsWithCompletingSuper(node);
  };

  const classMembers = (node: Node): Node[] =>
    isNode(node.body) && Array.isArray(node.body.body) ? node.body.body.filter(isNode) : [];

  function classDefinitionPrefixCompletes(node: Node): boolean {
    if (hasDecorators(node)) return false;
    if (isNode(node.superClass)) {
      const superClass = unwrap(node.superClass);
      if (
        superClass.type !== "FunctionExpression" &&
        (superClass.type !== "ClassExpression" || !classDefinitionCompletes(superClass))
      ) return false;
    }
    return true;
  }

  const computedPropertyKeyCompletes = (member: Node): boolean => {
    if (member.computed !== true) return true;
    if (!isNode(member.key)) return false;
    const key = unwrap(member.key);
    return key.type === "StringLiteral" || key.type === "NumericLiteral" ||
      key.type === "BooleanLiteral" || key.type === "NullLiteral" ||
      key.type === "BigIntLiteral" || key.type === "DecimalLiteral" ||
      (key.type === "TemplateLiteral" &&
        (!Array.isArray(key.expressions) || key.expressions.length === 0));
  };

  const classMemberPrefixCompletes = (member: Node): boolean =>
    !hasDecorators(member) && !hasParameterDecorators(member) &&
    computedPropertyKeyCompletes(member);

  const classMemberDefinitionCompletes = (member: Node): boolean => {
    if (!classMemberPrefixCompletes(member)) return false;
    if (member.type === "StaticBlock") {
      return Array.isArray(member.body) && member.body.length === 0;
    }
    if (
      member.static === true &&
      (member.type === "ClassProperty" || member.type === "ClassPrivateProperty" ||
        member.type === "ClassAccessorProperty")
    ) {
      return inertCompletionExpression(isNode(member.value) ? member.value : undefined);
    }
    return true;
  };

  function classDefinitionCompletes(node: Node): boolean {
    return classDefinitionPrefixCompletes(node) &&
      classMembers(node).every(classMemberDefinitionCompletes);
  }

  const isStaticInitializationElement = (member: Node): boolean =>
    member.type === "StaticBlock" ||
    (member.static === true &&
      (member.type === "ClassProperty" || member.type === "ClassPrivateProperty" ||
        member.type === "ClassAccessorProperty"));

  const markDeferredStaticElements = (node: Node): void => {
    let continues = classDefinitionPrefixCompletes(node);
    for (const member of classMembers(node)) {
      if (
        continues && classMemberPrefixCompletes(member) &&
        isStaticInitializationElement(member) && isNode(member.value)
      ) deferOrderedExpressionTail(member.value, noInitializedNames);
      if (
        continues && classMemberPrefixCompletes(member) && member.type === "StaticBlock" &&
        Array.isArray(member.body)
      ) deferStatementListTail(member.body, noInitializedNames);
      if (
        (!continues || !classMemberPrefixCompletes(member)) &&
        isStaticInitializationElement(member)
      ) deferred.add(member);
      if (continues && !classMemberDefinitionCompletes(member)) continues = false;
    }
  };

  const instanceInitializationCompletes = (node: Node): boolean =>
    classMembers(node).every((member) =>
      !isInstanceField(member) ||
      inertCompletionExpression(isNode(member.value) ? member.value : undefined)
    );

  function superclassConstructionCompletes(node: Node): boolean {
    if (!isNode(node.superClass)) return true;
    const superClass = unwrap(node.superClass);
    return superClass.type === "ClassExpression"
      ? constructionCompletes(superClass)
      : functionConstructionCompletes(superClass);
  }

  function constructsInstanceFields(node: Node): boolean {
    return !isNode(node.superClass) ||
      (invokesSuperclass(node) && superclassConstructionCompletes(node));
  }

  function constructionCompletes(node: Node): boolean {
    return classDefinitionCompletes(node) && constructsInstanceFields(node) &&
      instanceInitializationCompletes(node) && explicitConstructorCompletes(node);
  }

  const staticLiteralPropertyName = (node: Node): string | null => {
    const key = unwrap(node);
    if (key.type === "NullLiteral") return "null";
    if (
      key.type !== "StringLiteral" && key.type !== "NumericLiteral" &&
      key.type !== "BooleanLiteral" && key.type !== "BigIntLiteral" &&
      key.type !== "DecimalLiteral"
    ) return null;
    return typeof key.value === "string" || typeof key.value === "number" ||
        typeof key.value === "boolean" || typeof key.value === "bigint"
      ? String(key.value)
      : null;
  };

  const staticMemberName = (member: Node): string | null => {
    if (!isNode(member.property)) return null;
    return member.computed === true
      ? staticLiteralPropertyName(member.property)
      : nodeName(member.property) ?? staticLiteralPropertyName(member.property);
  };

  const staticObjectPropertyName = (property: Node): string | null => {
    if (!isNode(property.key)) return null;
    return property.computed === true
      ? staticLiteralPropertyName(property.key)
      : nodeName(property.key) ?? staticLiteralPropertyName(property.key);
  };

  const returnedInlineGetterFunction = (getter: Node): Node | null => {
    if (
      getter.type !== "ObjectMethod" || getter.kind !== "get" || !isNode(getter.body) ||
      !Array.isArray(getter.body.body) || getter.body.body.length !== 1
    ) return null;
    const statement = getter.body.body[0];
    if (!isNode(statement) || statement.type !== "ReturnStatement" || !isNode(statement.argument)) {
      return null;
    }
    const result = unwrap(statement.argument);
    return result.type === "FunctionExpression" || result.type === "ArrowFunctionExpression"
      ? result
      : null;
  };

  const getterEvaluationCompletes = (getter: Node): boolean => {
    if (
      getter.type !== "ObjectMethod" || getter.kind !== "get" || !isNode(getter.body) ||
      !Array.isArray(getter.body.body) || getter.body.body.length !== 1
    ) return false;
    const statement = getter.body.body[0];
    return isNode(statement) && statement.type === "ReturnStatement" &&
      (!isNode(statement.argument) || inertCompletionExpression(statement.argument));
  };

  const staticPrimitiveValue = (
    node: Node,
    initializedNames: ReadonlySet<string> = noInitializedNames,
  ):
    | { known: true; value: string | number | boolean | bigint | null | undefined }
    | { known: false } => {
    const expression = unwrap(node);
    if (expression.type === "NullLiteral") return { known: true, value: null };
    if (expression.type === "UnaryExpression" && isNode(expression.argument)) {
      if (
        expression.operator === "void" &&
        isInertExpression(expression.argument, noNameHelpers, initializedNames)
      ) return { known: true, value: undefined };
      if (expression.operator === "!") {
        const argument = staticPrimitiveValue(expression.argument, initializedNames);
        return argument.known
          ? { known: true, value: !staticValueIsTruthy(argument.value) }
          : { known: false };
      }
      if (expression.operator === "+" || expression.operator === "-") {
        const argument = staticPrimitiveValue(expression.argument, initializedNames);
        if (!argument.known) return { known: false };
        if (typeof argument.value === "number") {
          return {
            known: true,
            value: expression.operator === "+" ? argument.value : -argument.value,
          };
        }
        if (expression.operator === "-" && typeof argument.value === "bigint") {
          return { known: true, value: -argument.value };
        }
      }
    }
    if (expression.type === "BigIntLiteral" && typeof expression.value === "string") {
      try {
        return { known: true, value: BigInt(expression.value) };
      } catch {
        return { known: false };
      }
    }
    if (
      (expression.type === "StringLiteral" && typeof expression.value === "string") ||
      (expression.type === "NumericLiteral" && typeof expression.value === "number") ||
      (expression.type === "BooleanLiteral" && typeof expression.value === "boolean")
    ) return { known: true, value: expression.value };
    return { known: false };
  };

  const staticValueIsTruthy = (
    value: string | number | boolean | bigint | null | undefined,
  ): boolean =>
    value !== false && value !== 0 && value !== 0n && value !== "" && value !== null &&
    value !== undefined;

  const deferObjectPropertyEvaluation = (property: Node): void => {
    if (property.computed === true && isNode(property.key)) deferred.add(property.key);
    if (property.type === "ObjectProperty" && isNode(property.value)) {
      deferred.add(property.value);
    } else if (property.type === "SpreadElement" && isNode(property.argument)) {
      deferred.add(property.argument);
    }
  };

  const deferOrderedExpressionTail = (
    node: Node,
    initializedNames: ReadonlySet<string>,
  ): void => {
    const expression = unwrap(node);
    if (
      (expression.type === "SpreadElement" || expression.type === "AwaitExpression" ||
        expression.type === "UnaryExpression" || expression.type === "UpdateExpression") &&
      isNode(expression.argument)
    ) {
      deferOrderedExpressionTail(expression.argument, initializedNames);
      return;
    }
    if (
      expression.type === "JSXElement" && isNode(expression.openingElement) &&
      Array.isArray(expression.openingElement.attributes)
    ) {
      const attributes = expression.openingElement.attributes;
      const children = Array.isArray(expression.children) ? expression.children : [];
      const tag = isNode(expression.openingElement.name)
        ? expression.openingElement.name
        : undefined;
      let tagRoot = tag;
      while (tagRoot?.type === "JSXMemberExpression" && isNode(tagRoot.object)) {
        tagRoot = tagRoot.object;
      }
      const tagName = tagRoot?.type === "JSXIdentifier" ? nodeName(tagRoot) : null;
      const directTagName = tag?.type === "JSXIdentifier" ? nodeName(tag) ?? "" : "";
      const directTagFirst = directTagName.charCodeAt(0);
      const directTagIsIntrinsic = directTagFirst >= 97 && directTagFirst <= 122 ||
        directTagName.includes("-");
      const tagCompletes = tag?.type === "JSXIdentifier" && directTagIsIntrinsic ||
        tagRoot?.type === "JSXNamespacedName" || tagName === "this" ||
        (tag?.type === "JSXIdentifier" && tagName !== null && initializedNames.has(tagName));
      if (!tagCompletes) {
        for (const attribute of attributes) {
          if (isNode(attribute)) deferred.add(attribute);
        }
        for (const child of children) {
          if (isNode(child)) deferred.add(child);
        }
        return;
      }
      const evaluatedJsxNode = (value: unknown): Node | null => {
        if (!isNode(value)) return null;
        if (value.type === "JSXSpreadAttribute" && isNode(value.argument)) {
          return value.argument;
        }
        if (
          value.type === "JSXAttribute" && isNode(value.value) &&
          value.value.type === "JSXExpressionContainer" && isNode(value.value.expression)
        ) return value.value.expression;
        if (value.type === "JSXExpressionContainer" && isNode(value.expression)) {
          return value.expression;
        }
        if (value.type === "JSXSpreadChild" && isNode(value.expression)) {
          return value.expression;
        }
        return value.type === "JSXElement" || value.type === "JSXFragment" ? value : null;
      };
      for (let index = 0; index < attributes.length; index++) {
        const current = evaluatedJsxNode(attributes[index]);
        if (!current || isInertExpression(current, noNameHelpers, initializedNames)) continue;
        deferOrderedExpressionTail(current, initializedNames);
        for (const later of attributes.slice(index + 1)) {
          if (isNode(later)) deferred.add(later);
        }
        for (const child of children) {
          if (isNode(child)) deferred.add(child);
        }
        return;
      }
      for (let index = 0; index < children.length; index++) {
        const current = evaluatedJsxNode(children[index]);
        if (!current || isInertExpression(current, noNameHelpers, initializedNames)) continue;
        deferOrderedExpressionTail(current, initializedNames);
        for (const later of children.slice(index + 1)) {
          if (isNode(later)) deferred.add(later);
        }
        return;
      }
      return;
    }
    if (
      expression.type === "AssignmentExpression" && isNode(expression.left) &&
      isNode(expression.right) &&
      (expression.left.type === "MemberExpression" ||
        expression.left.type === "OptionalMemberExpression") &&
      isNode(expression.left.object)
    ) {
      const object = unwrap(expression.left.object);
      const objectCompletes = isInertExpression(
        expression.left.object,
        noNameHelpers,
        initializedNames,
      ) || (object.type === "Identifier" && nodeName(object) === "globalThis");
      const propertyCompletes = expression.left.computed !== true ||
        (isNode(expression.left.property) &&
          isInertExpression(expression.left.property, noNameHelpers, initializedNames));
      if (expression.operator === "=" && objectCompletes && propertyCompletes) {
        deferOrderedExpressionTail(expression.right, initializedNames);
        return;
      }
      if (!objectCompletes || !propertyCompletes) {
        deferOrderedExpressionTail(expression.left, initializedNames);
      }
      deferred.add(expression.right);
      return;
    }
    if (expression.type === "AssignmentExpression" && isNode(expression.right)) {
      deferOrderedExpressionTail(expression.right, initializedNames);
      return;
    }
    if (expression.type === "ObjectExpression" && Array.isArray(expression.properties)) {
      const properties = expression.properties;
      const deferPropertiesAfter = (index: number): void => {
        for (const later of properties.slice(index + 1)) {
          if (isNode(later)) deferObjectPropertyEvaluation(later);
        }
      };
      for (let index = 0; index < properties.length; index++) {
        const property = properties[index];
        if (!isNode(property)) {
          deferPropertiesAfter(index);
          return;
        }
        if (property.type === "SpreadElement") {
          if (isNode(property.argument)) {
            deferOrderedExpressionTail(property.argument, initializedNames);
          }
          deferPropertiesAfter(index);
          return;
        }
        if (
          property.computed === true && isNode(property.key) &&
          !computedPropertyKeyCompletes(property)
        ) {
          deferOrderedExpressionTail(property.key, initializedNames);
          if (property.type === "ObjectProperty" && isNode(property.value)) {
            deferred.add(property.value);
          }
          deferPropertiesAfter(index);
          return;
        }
        if (
          property.type === "ObjectProperty" && isNode(property.value) &&
          !isInertExpression(property.value, noNameHelpers, initializedNames)
        ) {
          deferOrderedExpressionTail(property.value, initializedNames);
          deferPropertiesAfter(index);
          return;
        }
      }
      return;
    }
    if (expression.type === "TemplateLiteral" && Array.isArray(expression.expressions)) {
      for (let index = 0; index < expression.expressions.length; index++) {
        const substitution = expression.expressions[index];
        if (!isNode(substitution)) continue;
        if (staticPrimitiveValue(substitution, initializedNames).known) continue;
        deferOrderedExpressionTail(substitution, initializedNames);
        for (const later of expression.expressions.slice(index + 1)) {
          if (isNode(later)) deferred.add(later);
        }
        return;
      }
      return;
    }
    if (
      expression.type === "TaggedTemplateExpression" && isNode(expression.tag) &&
      isNode(expression.quasi) && Array.isArray(expression.quasi.expressions)
    ) {
      const substitutions = expression.quasi.expressions;
      if (!isInertExpression(expression.tag, noNameHelpers, initializedNames)) {
        deferOrderedExpressionTail(expression.tag, initializedNames);
        for (const substitution of substitutions) {
          if (isNode(substitution)) deferred.add(substitution);
        }
        return;
      }
      for (let index = 0; index < substitutions.length; index++) {
        const substitution = substitutions[index];
        if (!isNode(substitution)) continue;
        if (isInertExpression(substitution, noNameHelpers, initializedNames)) continue;
        deferOrderedExpressionTail(substitution, initializedNames);
        for (const later of substitutions.slice(index + 1)) {
          if (isNode(later)) deferred.add(later);
        }
        return;
      }
      return;
    }
    if (
      (expression.type === "MemberExpression" ||
        expression.type === "OptionalMemberExpression") &&
      isNode(expression.object)
    ) {
      if (!isInertExpression(expression.object, noNameHelpers, initializedNames)) {
        deferOrderedExpressionTail(expression.object, initializedNames);
        if (expression.computed === true && isNode(expression.property)) {
          deferred.add(expression.property);
        }
        return;
      }
      if (
        expression.type === "OptionalMemberExpression" && expression.optional === true &&
        expression.computed === true && isNode(expression.property)
      ) {
        const object = staticPrimitiveValue(expression.object, initializedNames);
        if (object.known && (object.value === null || object.value === undefined)) {
          deferred.add(expression.property);
          return;
        }
      }
      if (expression.computed === true && isNode(expression.property)) {
        deferOrderedExpressionTail(expression.property, initializedNames);
      }
      return;
    }
    if (
      expression.type === "OptionalCallExpression" && expression.optional === true &&
      isNode(expression.callee) && Array.isArray(expression.arguments)
    ) {
      const callee = staticPrimitiveValue(expression.callee, initializedNames);
      if (callee.known && (callee.value === null || callee.value === undefined)) {
        for (const argument of expression.arguments) {
          if (isNode(argument)) deferred.add(argument);
        }
        return;
      }
    }
    if (
      (expression.type === "CallExpression" || expression.type === "OptionalCallExpression" ||
        expression.type === "NewExpression") &&
      isNode(expression.callee) && Array.isArray(expression.arguments)
    ) {
      if (!isInertExpression(expression.callee, noNameHelpers, initializedNames)) {
        deferOrderedExpressionTail(expression.callee, initializedNames);
        for (const argument of expression.arguments) {
          if (isNode(argument)) deferred.add(argument);
        }
        return;
      }
      for (let index = 0; index < expression.arguments.length; index++) {
        const argument = expression.arguments[index];
        if (!isNode(argument)) continue;
        if (isInertExpression(argument, noNameHelpers, initializedNames)) continue;
        deferOrderedExpressionTail(argument, initializedNames);
        for (const later of expression.arguments.slice(index + 1)) {
          if (isNode(later)) deferred.add(later);
        }
        return;
      }
      return;
    }
    if (
      expression.type === "LogicalExpression" && isNode(expression.left) &&
      isNode(expression.right)
    ) {
      const left = staticPrimitiveValue(expression.left, initializedNames);
      if (
        !left.known &&
        !isInertExpression(expression.left, noNameHelpers, initializedNames)
      ) {
        deferOrderedExpressionTail(expression.left, initializedNames);
        deferred.add(expression.right);
        return;
      }
      if (!left.known) return;
      const evaluatesRight = expression.operator === "&&"
        ? staticValueIsTruthy(left.value)
        : expression.operator === "||"
        ? !staticValueIsTruthy(left.value)
        : left.value === null || left.value === undefined;
      if (evaluatesRight) deferOrderedExpressionTail(expression.right, initializedNames);
      else deferred.add(expression.right);
      return;
    }
    if (
      expression.type === "ConditionalExpression" && isNode(expression.test) &&
      isNode(expression.consequent) && isNode(expression.alternate)
    ) {
      const test = staticPrimitiveValue(expression.test, initializedNames);
      if (
        !test.known &&
        !isInertExpression(expression.test, noNameHelpers, initializedNames)
      ) {
        deferOrderedExpressionTail(expression.test, initializedNames);
        deferred.add(expression.consequent);
        deferred.add(expression.alternate);
        return;
      }
      if (!test.known) {
        deferOrderedExpressionTail(expression.consequent, initializedNames);
        deferOrderedExpressionTail(expression.alternate, initializedNames);
        return;
      }
      const selected = staticValueIsTruthy(test.value)
        ? expression.consequent
        : expression.alternate;
      const skipped = staticValueIsTruthy(test.value)
        ? expression.alternate
        : expression.consequent;
      deferred.add(skipped);
      deferOrderedExpressionTail(selected, initializedNames);
      return;
    }
    const ordered =
      expression.type === "SequenceExpression" && Array.isArray(expression.expressions)
        ? expression.expressions
        : expression.type === "ArrayExpression" && Array.isArray(expression.elements)
        ? expression.elements
        : expression.type === "BinaryExpression" && isNode(expression.left) &&
            isNode(expression.right)
        ? [expression.left, expression.right]
        : null;
    if (!ordered) return;

    for (let index = 0; index < ordered.length; index++) {
      const current = ordered[index];
      if (!isNode(current)) continue;
      if (isInertExpression(current, noNameHelpers, initializedNames)) continue;
      deferOrderedExpressionTail(current, initializedNames);
      for (const later of ordered.slice(index + 1)) {
        if (isNode(later)) deferred.add(later);
      }
      return;
    }
  };

  type CompletionAtom =
    | "normal"
    | "throw"
    | "return"
    | "break"
    | "continue"
    | `break:${string}`
    | `continue:${string}`
    | `continue-target:${number}`
    | "unknown";
  type Completion =
    | CompletionAtom
    | `continue-targets:${string}`
    | `continue-mixed:${string}`
    | `completion-union:${string}`;
  const activeLoopTargets: Array<{ id: number; labels: readonly string[] }> = [];
  const loopTargetIds = new WeakMap<Node, number>();
  let nextLoopTargetId = 1;
  const isLoopStatement = (node: Node): boolean =>
    node.type === "WhileStatement" || node.type === "DoWhileStatement" ||
    node.type === "ForStatement" || node.type === "ForInStatement" ||
    node.type === "ForOfStatement";
  const loopTargetId = (node: Node): number => {
    const existing = loopTargetIds.get(node);
    if (existing !== undefined) return existing;
    const created = nextLoopTargetId++;
    loopTargetIds.set(node, created);
    return created;
  };
  const completionAtoms = (completion: Completion): CompletionAtom[] => {
    if (completion.startsWith("completion-union:")) {
      const encoded = completion.slice("completion-union:".length);
      return encoded.split(",").flatMap((alternative) =>
        completionAtoms(decodeURIComponent(alternative) as Completion)
      );
    }
    if (completion.startsWith("continue-mixed:")) {
      const [encodedTargets = "", ...abruptParts] = completion
        .slice("continue-mixed:".length).split("|");
      const targets = encodedTargets.split(",").map(Number).filter(Number.isInteger)
        .map((target) => `continue-target:${target}` as CompletionAtom);
      const abrupt = abruptParts.join("|");
      return abrupt ? [...targets, ...completionAtoms(abrupt as Completion)] : targets;
    }
    if (completion.startsWith("continue-targets:")) {
      return completion.slice("continue-targets:".length).split(",")
        .map(Number).filter(Number.isInteger)
        .map((target) => `continue-target:${target}` as CompletionAtom);
    }
    return [completion as CompletionAtom];
  };
  const completionFromAlternatives = (
    alternatives: Iterable<Completion>,
  ): Completion | null => {
    const atoms = [
      ...new Set(
        [...alternatives].flatMap(completionAtoms),
      ),
    ].sort();
    if (atoms.length === 0) return null;
    const only = atoms[0];
    if (atoms.length === 1 && only) return only;
    return `completion-union:${atoms.map(encodeURIComponent).join(",")}`;
  };
  const isContinueCompletionAtom = (completion: CompletionAtom): boolean =>
    completion === "continue" || completion.startsWith("continue:") ||
    completion.startsWith("continue-target:");
  const completionContinueTargets = (completion: Completion): number[] => {
    const targets: number[] = [];
    for (const alternative of completionAtoms(completion)) {
      if (alternative.startsWith("continue-target:")) {
        const parsed = Number(alternative.slice("continue-target:".length));
        if (Number.isInteger(parsed)) targets.push(parsed);
        continue;
      }
      if (alternative === "continue") {
        const target = activeLoopTargets[activeLoopTargets.length - 1];
        if (target) targets.push(target.id);
        continue;
      }
      if (alternative.startsWith("continue:")) {
        const label = alternative.slice("continue:".length);
        for (let index = activeLoopTargets.length - 1; index >= 0; index--) {
          const target = activeLoopTargets[index];
          if (target?.labels.includes(label)) {
            targets.push(target.id);
            break;
          }
        }
      }
    }
    return [...new Set(targets)].sort((left, right) => left - right);
  };
  const completionAbruptAlternative = (completion: Completion): Completion | null => {
    return completionFromAlternatives(
      completionAtoms(completion).filter((alternative) => !isContinueCompletionAtom(alternative)),
    );
  };
  const continueTargetsCompletion = (targets: Iterable<number>): Completion | null => {
    const unique = [...new Set(targets)].sort((left, right) => left - right);
    return completionFromAlternatives(
      unique.map((target) => `continue-target:${target}` as Completion),
    );
  };
  const mixedContinueCompletion = (
    targets: Iterable<number>,
    abrupt: Completion | null,
  ): Completion | null => {
    const targetCompletion = continueTargetsCompletion(targets);
    if (!targetCompletion) return abrupt;
    if (!abrupt) return targetCompletion;
    return completionFromAlternatives([targetCompletion, abrupt]);
  };
  const completionHasNormalAlternative = (completion: Completion): boolean =>
    completionAtoms(completion).includes("normal");
  const withoutNormalAlternative = (completion: Completion): Completion | null => {
    return completionFromAlternatives(
      completionAtoms(completion).filter((alternative) => alternative !== "normal"),
    );
  };
  const mergeCompletionAlternatives = (
    left: Completion | null,
    right: Completion,
  ): Completion => {
    if (!left) return right;
    return completionFromAlternatives([left, right]) ?? "unknown";
  };

  function deferStatementListTail(
    statements: unknown[],
    initializedNames: ReadonlySet<string>,
  ): Completion {
    const directThrownArguments = (statement: Node | undefined): Node[] | null => {
      if (!statement) return [];
      if (statement.type === "ThrowStatement") {
        return isNode(statement.argument) ? [statement.argument] : null;
      }
      if (statement.type === "BlockStatement" && Array.isArray(statement.body)) {
        const body = statement.body.filter(isNode);
        const onlyStatement = body[0];
        return body.length === 1 && onlyStatement ? directThrownArguments(onlyStatement) : null;
      }
      if (statement.type === "IfStatement") {
        const test = isNode(statement.test) ? statement.test : undefined;
        if (!test) return null;
        const value = staticPrimitiveValue(test, initializedNames);
        if (value.known) {
          const selected = staticValueIsTruthy(value.value)
            ? statement.consequent
            : statement.alternate;
          return directThrownArguments(isNode(selected) ? selected : undefined);
        }
        if (!isInertExpression(test, noNameHelpers, initializedNames)) return null;
        const consequent = directThrownArguments(
          isNode(statement.consequent) ? statement.consequent : undefined,
        );
        const alternate = directThrownArguments(
          isNode(statement.alternate) ? statement.alternate : undefined,
        );
        return consequent && alternate ? [...consequent, ...alternate] : null;
      }
      if (
        statement.type === "BreakStatement" || statement.type === "ContinueStatement" ||
        statement.type === "ReturnStatement" || statement.type === "EmptyStatement"
      ) {
        return [];
      }
      return null;
    };
    const definitelyNonNullish = (value: Node | null): boolean => {
      if (!value) return false;
      const primitive = staticPrimitiveValue(value, initializedNames);
      if (primitive.known) return primitive.value !== null && primitive.value !== undefined;
      const unwrapped = unwrap(value);
      const syntacticallyNonNullish = unwrapped.type === "ObjectExpression" ||
        unwrapped.type === "ArrayExpression" ||
        unwrapped.type === "FunctionExpression" || unwrapped.type === "ArrowFunctionExpression" ||
        unwrapped.type === "ClassExpression" || unwrapped.type === "RegExpLiteral";
      return syntacticallyNonNullish &&
        isInertExpression(value, noNameHelpers, initializedNames);
    };
    const catchParameterCompletion = (
      parameter: Node | null,
      thrownArguments: readonly Node[] | null,
    ): Completion => {
      if (!parameter || parameter.type === "Identifier") return "normal";
      if (
        parameter.type !== "ObjectPattern" || !thrownArguments || thrownArguments.length === 0
      ) {
        deferred.add(parameter);
        return "unknown";
      }
      let pendingCompletion: Completion | null = null;
      let hasNonNullishArgument = false;
      let hasEmptyObjectArgument = false;
      const properties = Array.isArray(parameter.properties) ? parameter.properties : [];
      const patternIsEmpty = properties.length === 0;
      for (const argument of thrownArguments) {
        const primitive = staticPrimitiveValue(argument, initializedNames);
        if (primitive.known && (primitive.value === null || primitive.value === undefined)) {
          pendingCompletion = mergeCompletionAlternatives(pendingCompletion, "throw");
          continue;
        }
        if (!definitelyNonNullish(argument)) {
          pendingCompletion = mergeCompletionAlternatives(pendingCompletion, "unknown");
          continue;
        }
        hasNonNullishArgument = true;
        const thrown = unwrap(argument);
        const isEmptyObject = thrown.type === "ObjectExpression" &&
          Array.isArray(thrown.properties) && thrown.properties.length === 0;
        if (isEmptyObject) {
          hasEmptyObjectArgument = true;
        } else if (!patternIsEmpty) {
          pendingCompletion = mergeCompletionAlternatives(pendingCompletion, "unknown");
        }
      }
      if (patternIsEmpty) {
        return hasNonNullishArgument
          ? mergeCompletionAlternatives(pendingCompletion, "normal")
          : pendingCompletion ?? "unknown";
      }
      if (!hasEmptyObjectArgument) {
        deferred.add(parameter);
        return pendingCompletion ?? "unknown";
      }
      const inheritedObjectProperties = new Set([
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
        "__proto__",
        "constructor",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "toString",
        "valueOf",
      ]);
      const deferLaterProperties = (index: number): void => {
        for (const later of properties.slice(index + 1)) {
          if (isNode(later)) deferred.add(later);
        }
      };
      for (let index = 0; index < properties.length; index++) {
        const property = properties[index];
        if (!isNode(property)) continue;
        if (property.type === "RestElement") {
          if (isNode(property.argument) && property.argument.type === "Identifier") {
            continue;
          }
          deferred.add(property);
          deferLaterProperties(index);
          return mergeCompletionAlternatives(pendingCompletion, "unknown");
        }
        if (property.type !== "ObjectProperty" || !isNode(property.value)) {
          deferred.add(property);
          deferLaterProperties(index);
          return mergeCompletionAlternatives(pendingCompletion, "unknown");
        }
        const key = property.type === "ObjectProperty" && property.computed === true &&
            isNode(property.key)
          ? property.key
          : null;
        if (
          key && !staticPrimitiveValue(key, initializedNames).known &&
          !isInertExpression(key, noNameHelpers, initializedNames)
        ) {
          deferOrderedExpressionTail(key, initializedNames);
          if (property.type === "ObjectProperty" && isNode(property.value)) {
            deferred.add(property.value);
          }
          deferLaterProperties(index);
          return mergeCompletionAlternatives(pendingCompletion, "unknown");
        }
        const value = property.value;
        if (value.type === "Identifier") continue;
        const propertyName = property.computed === true && key
          ? (() => {
            const keyValue = staticPrimitiveValue(key, initializedNames);
            return keyValue.known ? String(keyValue.value) : null;
          })()
          : nodeName(property.key);
        const defaultIsSkipped = propertyName !== null &&
          inheritedObjectProperties.has(propertyName);
        if (value.type === "AssignmentPattern" && defaultIsSkipped) {
          if (isNode(value.right)) deferred.add(value.right);
          if (isNode(value.left) && value.left.type === "Identifier") continue;
          if (isNode(value.left)) deferred.add(value.left);
          deferLaterProperties(index);
          return mergeCompletionAlternatives(pendingCompletion, "unknown");
        }
        if (
          value.type === "AssignmentPattern" && isNode(value.right) &&
          !isInertExpression(value.right, noNameHelpers, initializedNames)
        ) {
          deferOrderedExpressionTail(value.right, initializedNames);
          if (isNode(value.left) && value.left.type !== "Identifier") deferred.add(value.left);
          deferLaterProperties(index);
          return mergeCompletionAlternatives(pendingCompletion, "unknown");
        }
        if (
          value.type === "AssignmentPattern" && isNode(value.left) &&
          value.left.type === "Identifier"
        ) {
          continue;
        }
        deferred.add(value);
        deferLaterProperties(index);
        return mergeCompletionAlternatives(pendingCompletion, "unknown");
      }
      return mergeCompletionAlternatives(pendingCompletion, "normal");
    };
    const statementCompletion = (
      statement: Node,
      loopLabels: readonly string[] = [],
      loopTargetActive = false,
    ): Completion => {
      const statementIsLoop = isLoopStatement(statement);
      if (statementIsLoop && !loopTargetActive) {
        const target = { id: loopTargetId(statement), labels: loopLabels };
        activeLoopTargets.push(target);
        try {
          return statementCompletion(statement, loopLabels, true);
        } finally {
          activeLoopTargets.pop();
        }
      }
      const currentLoopTarget = statementIsLoop
        ? activeLoopTargets[activeLoopTargets.length - 1]
        : undefined;
      const consumeCurrentLoopContinue = (
        completion: Completion,
      ): { reachesCurrent: boolean; remaining: Completion | null } => {
        if (!currentLoopTarget) return { reachesCurrent: false, remaining: null };
        const targets = completionContinueTargets(completion);
        const reachesCurrent = targets.includes(currentLoopTarget.id) ||
          completion === "continue" ||
          loopLabels.some((label) => completion === `continue:${label}`);
        if (!reachesCurrent) return { reachesCurrent: false, remaining: null };
        return {
          reachesCurrent: true,
          remaining: mixedContinueCompletion(
            targets.filter((target) => target !== currentLoopTarget.id),
            completionAbruptAlternative(completion),
          ),
        };
      };
      const completeAlwaysContinuingLoop = (
        remaining: Completion | null,
      ): Completion => {
        if (!remaining) return "unknown";
        const alternatives = completionAtoms(remaining);
        const exitsWithBreak = alternatives.includes("break");
        const outward: CompletionAtom[] = alternatives.filter((alternative) =>
          alternative !== "normal" && alternative !== "break"
        );
        if (exitsWithBreak) outward.push("normal");
        return completionFromAlternatives(outward) ?? "unknown";
      };
      const consumeUnlabeledBreak = (completion: Completion): Completion =>
        completionFromAlternatives(
          completionAtoms(completion).map((alternative) =>
            alternative === "break" ? "normal" : alternative
          ),
        ) ?? "normal";
      if (statement.type === "BlockStatement" && Array.isArray(statement.body)) {
        return deferStatementListTail(statement.body, initializedNames);
      }
      if (statement.type === "ThrowStatement") {
        if (isNode(statement.argument)) {
          deferOrderedExpressionTail(statement.argument, initializedNames);
        }
        return "throw";
      }
      if (statement.type === "ReturnStatement") {
        if (!isNode(statement.argument)) return "return";
        const argumentCompletes = staticPrimitiveValue(
          statement.argument,
          initializedNames,
        ).known || isInertExpression(statement.argument, noNameHelpers, initializedNames);
        if (!argumentCompletes) {
          deferOrderedExpressionTail(statement.argument, initializedNames);
          return "unknown";
        }
        return "return";
      }
      if (statement.type === "BreakStatement") {
        const label = nodeName(statement.label);
        return label ? `break:${label}` : "break";
      }
      if (statement.type === "ContinueStatement") {
        const label = nodeName(statement.label);
        if (label) {
          for (let index = activeLoopTargets.length - 1; index >= 0; index--) {
            const target = activeLoopTargets[index];
            if (target?.labels.includes(label)) return `continue-target:${target.id}`;
          }
          return `continue:${label}`;
        }
        const target = activeLoopTargets[activeLoopTargets.length - 1];
        return target ? `continue-target:${target.id}` : "continue";
      }
      if (statement.type === "EmptyStatement" || statement.type === "FunctionDeclaration") {
        return "normal";
      }
      if (statement.type === "ExpressionStatement") {
        const expression = isNode(statement.expression) ? statement.expression : undefined;
        const completes = isInertExpression(
          expression,
          noNameHelpers,
          initializedNames,
        );
        if (!completes && expression) {
          deferOrderedExpressionTail(expression, initializedNames);
        }
        return completes ? "normal" : "unknown";
      }
      if (statement.type === "WhileStatement") {
        const test = isNode(statement.test) ? statement.test : undefined;
        const body = isNode(statement.body) ? statement.body : undefined;
        if (!test) {
          const bodyCompletion = body ? statementCompletion(body) : "normal";
          const continueFlow = consumeCurrentLoopContinue(bodyCompletion);
          return completeAlwaysContinuingLoop(
            continueFlow.reachesCurrent ? continueFlow.remaining : bodyCompletion,
          );
        }
        const value = staticPrimitiveValue(test, initializedNames);
        if (value.known && !staticValueIsTruthy(value.value)) {
          if (body) deferred.add(body);
          return "normal";
        }
        if (value.known && staticValueIsTruthy(value.value)) {
          const bodyCompletion = body ? statementCompletion(body) : "normal";
          const continueFlow = consumeCurrentLoopContinue(bodyCompletion);
          return completeAlwaysContinuingLoop(
            continueFlow.reachesCurrent ? continueFlow.remaining : bodyCompletion,
          );
        }
        if (!value.known && !isInertExpression(test, noNameHelpers, initializedNames)) {
          deferOrderedExpressionTail(test, initializedNames);
          if (body) deferred.add(body);
        }
        return "unknown";
      }
      if (statement.type === "DoWhileStatement") {
        const body = isNode(statement.body) ? statement.body : undefined;
        const test = isNode(statement.test) ? statement.test : undefined;
        const bodyCompletion = body ? statementCompletion(body) : "normal";
        if (bodyCompletion === "break") return "normal";
        const continueFlow = consumeCurrentLoopContinue(bodyCompletion);
        const bodyCanReachTest = completionHasNormalAlternative(bodyCompletion) ||
          continueFlow.reachesCurrent;
        if (!bodyCanReachTest) {
          if (test) deferred.add(test);
          return bodyCompletion;
        }
        if (!test) return "unknown";
        const pendingCompletion = continueFlow.reachesCurrent
          ? continueFlow.remaining
          : withoutNormalAlternative(bodyCompletion);
        const value = staticPrimitiveValue(test, initializedNames);
        if (value.known) {
          if (!staticValueIsTruthy(value.value)) {
            return mergeCompletionAlternatives(
              pendingCompletion ? consumeUnlabeledBreak(pendingCompletion) : null,
              "normal",
            );
          }
          return completeAlwaysContinuingLoop(pendingCompletion);
        }
        if (!isInertExpression(test, noNameHelpers, initializedNames)) {
          deferOrderedExpressionTail(test, initializedNames);
        }
        if (pendingCompletion) {
          return mergeCompletionAlternatives(
            consumeUnlabeledBreak(pendingCompletion),
            "normal",
          );
        }
        return "unknown";
      }
      if (statement.type === "ForStatement") {
        const init = isNode(statement.init) ? statement.init : undefined;
        const test = isNode(statement.test) ? statement.test : undefined;
        const update = isNode(statement.update) ? statement.update : undefined;
        const body = isNode(statement.body) ? statement.body : undefined;
        let initCompletion: Completion = "normal";
        const analyzeUpdate = (): void => {
          if (update && !isInertExpression(update, noNameHelpers, initializedNames)) {
            deferOrderedExpressionTail(update, initializedNames);
          }
        };
        if (init?.type === "VariableDeclaration") {
          initCompletion = statementCompletion(init);
        } else if (init && !isInertExpression(init, noNameHelpers, initializedNames)) {
          deferOrderedExpressionTail(init, initializedNames);
          initCompletion = "unknown";
        }
        if (initCompletion !== "normal") {
          if (test) deferred.add(test);
          if (update) deferred.add(update);
          if (body) deferred.add(body);
          return initCompletion;
        }
        if (!test) {
          const bodyCompletion = body ? statementCompletion(body) : "normal";
          const continueFlow = consumeCurrentLoopContinue(bodyCompletion);
          const bodyCanReachUpdate = completionHasNormalAlternative(bodyCompletion) ||
            continueFlow.reachesCurrent;
          if (!bodyCanReachUpdate && update) {
            deferred.add(update);
          }
          if (bodyCanReachUpdate) {
            analyzeUpdate();
          }
          return completeAlwaysContinuingLoop(
            continueFlow.reachesCurrent ? continueFlow.remaining : bodyCompletion,
          );
        }
        const value = staticPrimitiveValue(test, initializedNames);
        if (value.known && !staticValueIsTruthy(value.value)) {
          if (update) deferred.add(update);
          if (body) deferred.add(body);
          return "normal";
        }
        if (value.known && staticValueIsTruthy(value.value)) {
          const bodyCompletion = body ? statementCompletion(body) : "normal";
          const continueFlow = consumeCurrentLoopContinue(bodyCompletion);
          const bodyCanReachUpdate = completionHasNormalAlternative(bodyCompletion) ||
            continueFlow.reachesCurrent;
          if (!bodyCanReachUpdate && update) {
            deferred.add(update);
          }
          if (bodyCanReachUpdate) {
            analyzeUpdate();
          }
          return completeAlwaysContinuingLoop(
            continueFlow.reachesCurrent ? continueFlow.remaining : bodyCompletion,
          );
        }
        if (!value.known && !isInertExpression(test, noNameHelpers, initializedNames)) {
          deferOrderedExpressionTail(test, initializedNames);
          if (update) deferred.add(update);
          if (body) deferred.add(body);
        }
        return "unknown";
      }
      if (statement.type === "ForInStatement" || statement.type === "ForOfStatement") {
        const right = isNode(statement.right) ? statement.right : undefined;
        const body = isNode(statement.body) ? statement.body : undefined;
        if (right && !isInertExpression(right, noNameHelpers, initializedNames)) {
          deferOrderedExpressionTail(right, initializedNames);
          if (body) deferred.add(body);
        }
        return "unknown";
      }
      if (statement.type === "SwitchStatement") {
        const discriminant = isNode(statement.discriminant) ? statement.discriminant : undefined;
        const discriminantValue = discriminant
          ? staticPrimitiveValue(discriminant, initializedNames)
          : { known: false as const };
        const cases = Array.isArray(statement.cases) ? statement.cases : [];
        const deferCaseEvaluation = (caseNode: Node): void => {
          if (isNode(caseNode.test)) deferred.add(caseNode.test);
          for (const consequent of Array.isArray(caseNode.consequent) ? caseNode.consequent : []) {
            if (isNode(consequent)) deferred.add(consequent);
          }
        };
        if (
          discriminant &&
          !discriminantValue.known &&
          !isInertExpression(discriminant, noNameHelpers, initializedNames)
        ) {
          deferOrderedExpressionTail(discriminant, initializedNames);
          for (const caseNode of cases) {
            if (isNode(caseNode)) deferCaseEvaluation(caseNode);
          }
          return "unknown";
        }
        let possibleEarlierEntry = false;
        let earlierDefault: Node | null = null;
        let earlierDefaultIndex = -1;
        let defaultReachableByPriorMatch = false;
        let earlierDefaultCompletion: Completion | null = null;
        let possibleCaseMatch = false;
        let possibleCompletedEntry: Completion | null = null;
        const mergeCompletedEntry = (completion: Completion): void => {
          const normalized = consumeUnlabeledBreak(completion);
          if (possibleCompletedEntry === null) {
            possibleCompletedEntry = normalized;
          } else if (possibleCompletedEntry !== normalized) {
            possibleCompletedEntry = mergeCompletionAlternatives(
              possibleCompletedEntry,
              normalized,
            );
          }
        };
        for (let index = 0; index < cases.length; index++) {
          const caseNode = cases[index];
          if (!isNode(caseNode)) continue;
          if (!isNode(caseNode.test)) {
            earlierDefault = caseNode;
            earlierDefaultIndex = index;
            defaultReachableByPriorMatch = possibleEarlierEntry;
            possibleEarlierEntry = true;
            if (Array.isArray(caseNode.consequent)) {
              const defaultCompletion = deferStatementListTail(
                caseNode.consequent,
                initializedNames,
              );
              earlierDefaultCompletion = defaultCompletion;
              const pendingDefault = withoutNormalAlternative(defaultCompletion);
              if (defaultReachableByPriorMatch && pendingDefault) {
                mergeCompletedEntry(pendingDefault);
              }
              possibleEarlierEntry = completionHasNormalAlternative(defaultCompletion);
            }
            continue;
          }
          const test = caseNode.test;
          const testValue = staticPrimitiveValue(test, initializedNames);
          if (
            discriminantValue.known && testValue.known &&
            discriminantValue.value === testValue.value
          ) {
            if (earlierDefault && !defaultReachableByPriorMatch) {
              for (
                const consequent of Array.isArray(earlierDefault.consequent)
                  ? earlierDefault.consequent
                  : []
              ) {
                if (isNode(consequent)) deferred.add(consequent);
              }
            }
            for (const later of cases.slice(index + 1)) {
              if (isNode(later) && isNode(later.test)) deferred.add(later.test);
            }
            const selectedStatements = cases.slice(index).flatMap((selectedCase) =>
              isNode(selectedCase) && Array.isArray(selectedCase.consequent)
                ? selectedCase.consequent.filter(isNode)
                : []
            );
            const selectedCompletion = deferStatementListTail(
              selectedStatements,
              initializedNames,
            );
            mergeCompletedEntry(selectedCompletion);
            return possibleCompletedEntry ?? "unknown";
          }
          if (discriminantValue.known && testValue.known) {
            if (!possibleEarlierEntry) {
              for (
                const consequent of Array.isArray(caseNode.consequent) ? caseNode.consequent : []
              ) {
                if (isNode(consequent)) deferred.add(consequent);
              }
            } else if (Array.isArray(caseNode.consequent)) {
              const mismatchCompletion = deferStatementListTail(
                caseNode.consequent,
                initializedNames,
              );
              const pendingMismatch = withoutNormalAlternative(mismatchCompletion);
              if (pendingMismatch) {
                mergeCompletedEntry(pendingMismatch);
              }
              possibleEarlierEntry = completionHasNormalAlternative(mismatchCompletion);
            }
            continue;
          }
          if (testValue.known || isInertExpression(test, noNameHelpers, initializedNames)) {
            possibleCaseMatch = true;
            possibleEarlierEntry = true;
            if (Array.isArray(caseNode.consequent)) {
              const caseCompletion = deferStatementListTail(
                caseNode.consequent,
                initializedNames,
              );
              const pendingCase = withoutNormalAlternative(caseCompletion);
              if (pendingCase) {
                mergeCompletedEntry(pendingCase);
              }
              possibleEarlierEntry = completionHasNormalAlternative(caseCompletion);
            }
            continue;
          }
          deferOrderedExpressionTail(test, initializedNames);
          if (!possibleEarlierEntry) {
            for (
              const consequent of Array.isArray(caseNode.consequent) ? caseNode.consequent : []
            ) {
              if (isNode(consequent)) deferred.add(consequent);
            }
          } else if (Array.isArray(caseNode.consequent)) {
            const fallthroughCompletion = deferStatementListTail(
              caseNode.consequent,
              initializedNames,
            );
            const pendingFallthrough = withoutNormalAlternative(fallthroughCompletion);
            if (pendingFallthrough) {
              mergeCompletedEntry(pendingFallthrough);
            }
            possibleEarlierEntry = completionHasNormalAlternative(fallthroughCompletion);
          }
          const laterCases = cases.slice(index + 1);
          for (const later of laterCases) {
            if (!isNode(later)) continue;
            if (isNode(later.test)) deferred.add(later.test);
          }
          if (possibleEarlierEntry) {
            const laterStatements = laterCases.flatMap((later) =>
              isNode(later) && Array.isArray(later.consequent)
                ? later.consequent.filter(isNode)
                : []
            );
            mergeCompletedEntry(
              deferStatementListTail(laterStatements, initializedNames),
            );
          } else {
            for (const later of laterCases) {
              if (!isNode(later)) continue;
              for (const consequent of Array.isArray(later.consequent) ? later.consequent : []) {
                if (isNode(consequent)) deferred.add(consequent);
              }
            }
          }
          mergeCompletedEntry("unknown");
          return possibleCompletedEntry ?? "unknown";
        }
        if (
          discriminantValue.known && earlierDefault && earlierDefaultIndex >= 0 &&
          !possibleCaseMatch
        ) {
          const selectedStatements = cases.slice(earlierDefaultIndex).flatMap((selectedCase) =>
            isNode(selectedCase) && Array.isArray(selectedCase.consequent)
              ? selectedCase.consequent.filter(isNode)
              : []
          );
          const selectedCompletion = deferStatementListTail(
            selectedStatements,
            initializedNames,
          );
          return consumeUnlabeledBreak(selectedCompletion);
        }
        if (discriminantValue.known && !possibleCaseMatch && !earlierDefault) {
          return "normal";
        }
        if (possibleCaseMatch) {
          if (earlierDefault) {
            if (earlierDefaultCompletion) {
              const pendingDefault = withoutNormalAlternative(earlierDefaultCompletion);
              if (pendingDefault) mergeCompletedEntry(pendingDefault);
            }
          } else {
            mergeCompletedEntry("normal");
          }
          if (possibleEarlierEntry) mergeCompletedEntry("normal");
        }
        return possibleCompletedEntry ?? "unknown";
      }
      if (statement.type === "TryStatement") {
        const block = isNode(statement.block) ? statement.block : undefined;
        const handler = isNode(statement.handler) ? statement.handler : undefined;
        const finalizer = isNode(statement.finalizer) ? statement.finalizer : undefined;
        let completion: Completion = block ? statementCompletion(block) : "normal";
        if (handler) {
          const tryAlternatives = completionAtoms(completion);
          const hasThrowAlternative = tryAlternatives.includes("throw");
          if (!hasThrowAlternative && !tryAlternatives.includes("unknown")) {
            deferred.add(handler);
          } else if (isNode(handler.body)) {
            const parameter = isNode(handler.param) ? handler.param : null;
            const parameterCompletion = catchParameterCompletion(
              parameter,
              directThrownArguments(block),
            );
            const parameterCanComplete = completionHasNormalAlternative(parameterCompletion);
            if (!parameterCanComplete) deferred.add(handler.body);
            const handlerCompletion: Completion = parameterCanComplete
              ? mergeCompletionAlternatives(
                withoutNormalAlternative(parameterCompletion),
                statementCompletion(handler.body),
              )
              : parameterCompletion;
            if (hasThrowAlternative) {
              const nonThrowCompletion = completionFromAlternatives(
                tryAlternatives.filter((alternative) => alternative !== "throw"),
              );
              completion = mergeCompletionAlternatives(
                nonThrowCompletion,
                handlerCompletion,
              );
            }
          }
        }
        if (finalizer) {
          const finalizerCompletion = statementCompletion(finalizer);
          if (!completionHasNormalAlternative(finalizerCompletion)) {
            completion = finalizerCompletion;
          } else {
            completion = mergeCompletionAlternatives(
              withoutNormalAlternative(finalizerCompletion),
              completion,
            );
          }
        }
        return completion;
      }
      if (statement.type === "LabeledStatement" && isNode(statement.body)) {
        const label = nodeName(statement.label);
        const bodyIsLoop = statement.body.type === "WhileStatement" ||
          statement.body.type === "DoWhileStatement" || statement.body.type === "ForStatement" ||
          statement.body.type === "ForInStatement" || statement.body.type === "ForOfStatement";
        const carriesLoopLabels = bodyIsLoop || statement.body.type === "LabeledStatement";
        const nestedLoopLabels = label ? [...loopLabels, label] : loopLabels;
        const completion = statementCompletion(
          statement.body,
          carriesLoopLabels ? nestedLoopLabels : [],
        );
        if (label) {
          const consumedBreak = completionFromAlternatives(
            completionAtoms(completion).map((alternative) =>
              alternative === `break:${label}` ? "normal" : alternative
            ),
          );
          if (consumedBreak && consumedBreak !== completion) return consumedBreak;
        }
        if (label && completion === `continue:${label}`) return "unknown";
        return completion;
      }
      if (statement.type === "IfStatement") {
        const test = isNode(statement.test) ? statement.test : undefined;
        if (test) {
          const value = staticPrimitiveValue(test, initializedNames);
          if (value.known) {
            const selected = staticValueIsTruthy(value.value)
              ? statement.consequent
              : statement.alternate;
            const skipped = staticValueIsTruthy(value.value)
              ? statement.alternate
              : statement.consequent;
            if (isNode(skipped)) deferred.add(skipped);
            return isNode(selected) ? statementCompletion(selected) : "normal";
          }
        }
        if (test && !isInertExpression(test, noNameHelpers, initializedNames)) {
          deferOrderedExpressionTail(test, initializedNames);
          if (isNode(statement.consequent)) deferred.add(statement.consequent);
          if (isNode(statement.alternate)) deferred.add(statement.alternate);
          return "unknown";
        }
        if (test) {
          const consequentCompletion = isNode(statement.consequent)
            ? statementCompletion(statement.consequent)
            : "normal";
          const alternateCompletion = isNode(statement.alternate)
            ? statementCompletion(statement.alternate)
            : "normal";
          if (consequentCompletion === alternateCompletion) return consequentCompletion;
          return mergeCompletionAlternatives(consequentCompletion, alternateCompletion);
        }
        return "unknown";
      }
      if (statement.type !== "VariableDeclaration") return "unknown";
      const declarators = declaratorsOf(statement);
      for (let index = 0; index < declarators.length; index++) {
        const declarator = declarators[index];
        if (!declarator) return "unknown";
        const completes = isNode(declarator.id) && declarator.id.type === "Identifier" &&
          isInertExpression(
            isNode(declarator.init) ? declarator.init : undefined,
            noNameHelpers,
            initializedNames,
          );
        if (completes) continue;
        if (isNode(declarator.init)) {
          deferOrderedExpressionTail(declarator.init, initializedNames);
        }
        for (const later of declarators.slice(index + 1)) deferred.add(later);
        return "unknown";
      }
      return "normal";
    };

    let completion: Completion = "normal";
    for (const statement of statements) {
      if (!isNode(statement)) continue;
      if (completion === "normal") {
        completion = statementCompletion(statement);
      } else if (completionHasNormalAlternative(completion)) {
        const pending = withoutNormalAlternative(completion);
        completion = mergeCompletionAlternatives(
          pending,
          statementCompletion(statement),
        );
      } else {
        deferred.add(statement);
      }
    }
    return completion;
  }

  const evaluatedInvocationArguments = (node: Node): unknown[] | null => {
    if (
      node.type === "CallExpression" || node.type === "OptionalCallExpression" ||
      node.type === "NewExpression"
    ) return Array.isArray(node.arguments) ? node.arguments : null;
    if (node.type !== "TaggedTemplateExpression" || !isNode(node.quasi)) return null;
    return Array.isArray(node.quasi.expressions) ? node.quasi.expressions : [];
  };

  const invocationArgumentsComplete = (
    node: Node,
    initializedNames: ReadonlySet<string>,
  ): boolean => {
    const argumentsToEvaluate = evaluatedInvocationArguments(node);
    if (!argumentsToEvaluate) return false;
    for (let index = 0; index < argumentsToEvaluate.length; index++) {
      const argument = argumentsToEvaluate[index];
      if (isNode(argument) && isInertExpression(argument, noNameHelpers, initializedNames)) {
        continue;
      }
      if (isNode(argument)) deferOrderedExpressionTail(argument, initializedNames);
      for (const later of argumentsToEvaluate.slice(index + 1)) {
        if (isNode(later)) deferred.add(later);
      }
      return false;
    }
    return true;
  };

  const isDefinitelyDefinedArgument = (node: Node): boolean => {
    const argument = unwrap(node);
    return argument.type === "StringLiteral" || argument.type === "NumericLiteral" ||
      argument.type === "BooleanLiteral" || argument.type === "NullLiteral" ||
      argument.type === "BigIntLiteral" || argument.type === "DecimalLiteral" ||
      argument.type === "RegExpLiteral" || argument.type === "FunctionExpression" ||
      argument.type === "ArrowFunctionExpression" || argument.type === "ClassExpression" ||
      argument.type === "ArrayExpression" || argument.type === "ObjectExpression" ||
      (argument.type === "TemplateLiteral" &&
        (!Array.isArray(argument.expressions) || argument.expressions.length === 0));
  };

  const parameterInitializationBoundary = (
    node: Node,
    invocationArguments: unknown[],
    initializedNames: ReadonlySet<string>,
  ): number | null => {
    if (!Array.isArray(node.params)) return 0;

    const parameterNames = new Set<string>();
    for (const parameter of node.params) {
      if (!isNode(parameter)) return 0;
      for (const binding of patternBindingIdentifiers(parameter)) {
        const name = nodeName(binding);
        if (name) parameterNames.add(name);
      }
    }
    const initializedForDefault = new Set(
      [...initializedNames].filter((name) => !parameterNames.has(name)),
    );
    if (node.type === "FunctionExpression") {
      const ownName = nodeName(node.id);
      if (ownName) initializedForDefault.add(ownName);
    }

    for (let index = 0; index < node.params.length; index++) {
      const parameter = node.params[index];
      if (!isNode(parameter)) return index;
      if (parameter.type === "Identifier") {
        const name = nodeName(parameter);
        if (name) initializedForDefault.add(name);
        continue;
      }
      if (
        parameter.type === "RestElement" && isNode(parameter.argument) &&
        parameter.argument.type === "Identifier"
      ) {
        const name = nodeName(parameter.argument);
        if (name) initializedForDefault.add(name);
        continue;
      }
      if (
        parameter.type !== "AssignmentPattern" || !isNode(parameter.left) ||
        parameter.left.type !== "Identifier" || !isNode(parameter.right)
      ) return index;

      const argument = invocationArguments[index];
      const defaultIsSkipped = isNode(argument) && isDefinitelyDefinedArgument(argument);
      if (defaultIsSkipped) {
        deferred.add(parameter.right);
      } else if (!isInertExpression(parameter.right, noNameHelpers, initializedForDefault)) {
        deferOrderedExpressionTail(parameter.right, initializedForDefault);
        return index;
      }
      const name = nodeName(parameter.left);
      if (name) initializedForDefault.add(name);
    }
    return null;
  };

  const invocationArgumentsFor = (invocation: Node, target: Node): unknown[] | null => {
    if (invocation.type === "NewExpression") {
      return Array.isArray(invocation.arguments) ? invocation.arguments : null;
    }
    if (invocation.type === "TaggedTemplateExpression") {
      if (!isNode(invocation.quasi)) return null;
      const substitutions = Array.isArray(invocation.quasi.expressions)
        ? invocation.quasi.expressions
        : [];
      return [{ type: "ArrayExpression", elements: [] }, ...substitutions];
    }
    if (
      (invocation.type !== "CallExpression" && invocation.type !== "OptionalCallExpression") ||
      !Array.isArray(invocation.arguments) || !isNode(invocation.callee)
    ) return null;
    const callee = unwrap(invocation.callee);
    if (
      callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression" ||
      !isNode(callee.object)
    ) return invocation.arguments;
    const receiver = unwrap(callee.object);
    if (receiver !== target) return invocation.arguments;
    const method = staticMemberName(callee);
    if (method === "call") return invocation.arguments.slice(1);
    if (method !== "apply") return invocation.arguments;

    const applied = invocation.arguments[1];
    if (!isNode(applied) || applied.type === "NullLiteral") return [];
    return applied.type === "ArrayExpression" && Array.isArray(applied.elements)
      ? applied.elements
      : null;
  };

  const markCalledFunction = (
    target: Node,
    invocation: Node,
    scopes: ExecutionScope[],
  ): boolean => {
    if (target.generator === true) return false;
    const initializedAtCall = initializedNamesAtCall(invocation, scopes);
    if (!invocationArgumentsComplete(invocation, initializedAtCall)) return false;
    const invocationArguments = invocationArgumentsFor(invocation, target);
    if (!invocationArguments) return false;

    executedNodes.add(target);
    const boundary = parameterInitializationBoundary(
      target,
      invocationArguments,
      initializedAtCall,
    );
    if (boundary === null) {
      if (
        isNode(target.body) && target.body.type === "BlockStatement" &&
        Array.isArray(target.body.body)
      ) {
        deferStatementListTail(target.body.body, initializedAtCall);
      }
      return true;
    }
    const targetParameters = Array.isArray(target.params) ? target.params : [];
    const boundaryParameter = targetParameters[boundary];
    const firstDeferredParameter = isNode(boundaryParameter) &&
        boundaryParameter.type === "AssignmentPattern" && isNode(boundaryParameter.left) &&
        boundaryParameter.left.type === "Identifier"
      ? boundary + 1
      : boundary;
    for (let index = firstDeferredParameter; index < targetParameters.length; index++) {
      const parameter = targetParameters[index];
      if (isNode(parameter)) deferred.add(parameter);
    }
    if (isNode(target.body)) deferred.add(target.body);
    return false;
  };

  const invokedInlineObjectFunction = (callee: Node): Node | null => {
    if (
      (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") ||
      !isNode(callee.object) ||
      !isNode(callee.property)
    ) return null;
    const object = unwrap(callee.object);
    if (object.type !== "ObjectExpression" || !Array.isArray(object.properties)) return null;
    const selectedName = staticMemberName(callee);
    if (selectedName === null) return null;

    const properties = object.properties;
    const deferPropertiesAfter = (index: number): void => {
      for (const later of properties.slice(index + 1)) {
        if (isNode(later)) deferObjectPropertyEvaluation(later);
      }
    };

    let selected: Node | null = null;
    for (let index = 0; index < properties.length; index++) {
      const property = properties[index];
      if (!isNode(property)) {
        deferPropertiesAfter(index);
        return null;
      }
      const propertyName = staticObjectPropertyName(property);
      if (propertyName === null) {
        if (
          property.computed === true && isNode(property.key) &&
          !inertCompletionExpression(property.key)
        ) {
          deferOrderedExpressionTail(property.key, noInitializedNames);
          if (property.type === "ObjectProperty" && isNode(property.value)) {
            deferred.add(property.value);
          } else if (property.type === "SpreadElement" && isNode(property.argument)) {
            deferred.add(property.argument);
          }
        }
        deferPropertiesAfter(index);
        return null;
      }

      let target: Node | null = null;
      if (
        property.type === "ObjectMethod" &&
        (property.kind === "method" || property.kind === "get")
      ) {
        target = property;
      } else if (
        property.type === "ObjectProperty" && propertyName !== "__proto__" &&
        isNode(property.value)
      ) {
        const value = unwrap(property.value);
        if (value.type === "FunctionExpression" || value.type === "ArrowFunctionExpression") {
          target = value;
        }
      }
      const creationCompletes = target !== null ||
        (property.type === "ObjectProperty" && propertyName !== "__proto__" &&
          isNode(property.value) && inertCompletionExpression(property.value)) ||
        property.type === "ObjectMethod";
      // Creation must finish before member access and invocation. Track the
      // last property with the selected name so an inert value or accessor
      // that overwrites a method does not make the earlier body look invoked.
      if (!creationCompletes) {
        deferPropertiesAfter(index);
        return null;
      }
      if (propertyName === selectedName) {
        const completesSelectedAccessor = property.type === "ObjectMethod" &&
          property.kind === "set" && selected?.type === "ObjectMethod" &&
          selected.kind === "get";
        if (!completesSelectedAccessor) selected = target;
      }
    }
    return selected;
  };

  const invokedChild = (node: Node): Node | null => {
    if (node.type === "CallExpression" && isNode(node.callee)) {
      const callee = unwrap(node.callee);
      // A direct function literal invoked through its standard `.call` or
      // `.apply` entry point runs here just as a plain IIFE does. Keep this
      // narrow: an arbitrary receiver's method says nothing about whether a
      // callback argument or another function body executes.
      if (
        callee.type === "MemberExpression" && isNode(callee.object) &&
        isNode(callee.property)
      ) {
        const method = callee.computed === true && callee.property.type === "StringLiteral" &&
            typeof callee.property.value === "string"
          ? callee.property.value
          : callee.computed !== true
          ? nodeName(callee.property)
          : null;
        const target = unwrap(callee.object);
        if (
          (method === "call" || method === "apply") &&
          (target.type === "FunctionExpression" || target.type === "ArrowFunctionExpression")
        ) {
          return target;
        }
      }
      const objectFunction = invokedInlineObjectFunction(callee);
      if (objectFunction) return objectFunction;
      return callee;
    }
    if (node.type === "OptionalCallExpression" && isNode(node.callee)) {
      const callee = unwrap(node.callee);
      return invokedInlineObjectFunction(callee) ?? callee;
    }
    if (node.type === "NewExpression") {
      return isNode(node.callee) ? unwrap(node.callee) : null;
    }
    if (node.type === "TaggedTemplateExpression") {
      return isNode(node.tag) ? unwrap(node.tag) : null;
    }
    return null;
  };

  type ConstructedClassBodyMode = "all" | "constructor-only" | "fields-only" | null;

  const walk = (
    node: Node,
    constructedClassBody: ConstructedClassBodyMode = null,
    localScopes: ExecutionScope[] = [],
  ): void => {
    const introducedScope = node.type === "Program" ? null : executionScopeFor(node);
    const activeScopes = introducedScope ? [introducedScope, ...localScopes] : localScopes;
    if (
      node.type === "ExpressionStatement" && isNode(node.expression) &&
      unwrap(node.expression).type === "AssignmentExpression"
    ) {
      deferOrderedExpressionTail(
        node.expression,
        initializedNamesAtCall(node, activeScopes),
      );
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      markDeferredStaticElements(node);
    }
    const isFunction = node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" || node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod";
    const executesNow = executedNodes.has(node) || constructedClasses.has(node);

    if (
      (isFunction &&
        (node.generator === true || !executesNow)) ||
      (isInstanceField(node) && !executesNow)
    ) {
      deferred.add(node);
    }

    const constructsInlineClass = node.type === "ClassExpression" &&
      constructedClasses.has(node);
    const completesInlineClassDefinition = constructsInlineClass &&
      classDefinitionCompletes(node);
    if (
      completesInlineClassDefinition && invokesSuperclass(node) &&
      isNode(node.superClass)
    ) {
      const superClass = unwrap(node.superClass);
      // An implicit derived constructor synchronously constructs its inline
      // base. Explicit constructors may return another object without `super()`.
      if (superClass.type === "ClassExpression") constructedClasses.add(superClass);
    }
    const nextInvoked = invokedChild(node);
    if (nextInvoked) {
      if (node.type === "NewExpression") {
        const initializedAtConstruction = initializedNamesAtCall(node, activeScopes);
        const calleeCompletes = nextInvoked.type !== "ClassExpression" ||
          classDefinitionCompletes(nextInvoked);
        if (!calleeCompletes) {
          for (const argument of Array.isArray(node.arguments) ? node.arguments : []) {
            if (isNode(argument)) deferred.add(argument);
          }
        } else if (invocationArgumentsComplete(node, initializedAtConstruction)) {
          if (nextInvoked.type === "ClassExpression") {
            const constructor = explicitConstructor(nextInvoked);
            const parametersComplete = constructor
              ? markCalledFunction(constructor, node, activeScopes)
              : true;
            if (parametersComplete) {
              constructedClasses.add(nextInvoked);
              if (
                constructor && constructsInstanceFields(nextInvoked) &&
                !instanceInitializationCompletes(nextInvoked) && isNode(constructor.body)
              ) deferred.add(constructor.body);
            }
          } else if (
            nextInvoked.type === "FunctionExpression" && nextInvoked.async !== true &&
            nextInvoked.generator !== true
          ) {
            markCalledFunction(nextInvoked, node, activeScopes);
          }
        }
      } else if (
        nextInvoked.type === "FunctionExpression" ||
        nextInvoked.type === "ArrowFunctionExpression" ||
        nextInvoked.type === "ObjectMethod"
      ) {
        if (nextInvoked.type === "ObjectMethod" && nextInvoked.kind === "get") {
          // Member access runs the getter before call arguments are evaluated.
          executedNodes.add(nextInvoked);
          const getterResult = returnedInlineGetterFunction(nextInvoked);
          if (getterResult) {
            markCalledFunction(getterResult, node, activeScopes);
          } else if (getterEvaluationCompletes(nextInvoked)) {
            invocationArgumentsComplete(
              node,
              initializedNamesAtCall(node, activeScopes),
            );
          } else {
            for (const argument of evaluatedInvocationArguments(node) ?? []) {
              if (isNode(argument)) deferred.add(argument);
            }
          }
        } else {
          markCalledFunction(nextInvoked, node, activeScopes);
        }
      }
    }
    let phaseScope = introducedScope;
    let instanceFieldsContinue = constructedClassBody === "all" ||
      constructedClassBody === "fields-only";
    const parameters = isFunction && Array.isArray(node.params) ? node.params.filter(isNode) : [];
    for (const child of children(node)) {
      const scopesAtChild = phaseScope ? [phaseScope, ...localScopes] : localScopes;
      const entersConstructedClassBody = completesInlineClassDefinition &&
          child.type === "ClassBody"
        ? constructsInstanceFields(node)
          ? instanceInitializationCompletes(node) ? "all" : "fields-only"
          : "constructor-only"
        : null;
      if (
        instanceFieldsContinue && isInstanceField(child) && isNode(child.value)
      ) {
        deferOrderedExpressionTail(child.value, noInitializedNames);
      }
      const invokedMember = constructedClassBody !== null &&
          ((isConstructor(child) && constructedClassBody !== "fields-only") ||
            (instanceFieldsContinue && isInstanceField(child)))
        ? child
        : null;
      if (invokedMember) executedNodes.add(invokedMember);
      const entersCompletedBindingPhase = phaseScope !== null &&
        ((isFunction && child === node.body) ||
          ((node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
            child.type === "ClassBody"));
      const childScopes = entersCompletedBindingPhase && phaseScope
        ? [withUnknownBindingsInitialized(phaseScope), ...localScopes]
        : scopesAtChild;
      walk(child, entersConstructedClassBody, childScopes);
      if (phaseScope && isFunction && parameters.includes(child)) {
        phaseScope = withUnknownBindingsInitialized(
          phaseScope,
          new Set(patternBoundNames(child)),
        );
      }
      if (
        instanceFieldsContinue && isInstanceField(child) &&
        !inertCompletionExpression(isNode(child.value) ? child.value : undefined)
      ) instanceFieldsContinue = false;
    }
  };

  walk(root);
  return deferred;
}

/**
 * Whether a declaration can be left out of the root computation: whether the
 * module reading a name *there* is a reason to keep that name alive.
 *
 * Three shapes say it is not:
 *
 * - The declaration is already in the hooks' dependency closure by name. This
 *   is what the pass exists to drop: `const API_KEY = getEnv(…)` goes, impure
 *   initialiser and all.
 * - Its declaration does not run at all, so it is not surviving code.
 * - A `var` hoisted out of nested control flow evaluates only that closure.
 *   `switch (…) { case 1: var dead = createHash("md5") }` can otherwise pin a
 *   server-only import even though nothing reads `dead`. This exception does
 *   not apply to a direct top-level initialiser, whose side effect is part of
 *   the module even when it happens to call the same import as the hook, and
 *   eliding it from the roots is not on its own a licence to delete it. See
 *   `dropUnreachableModuleScopeBindings`, which still keeps the statement when
 *   any binding it evaluates survives.
 *
 * Anything else roots what it evaluates like any other side-effectful top-level
 * statement. That is what keeps `const clientInit = bootClientAnalytics()`,
 * and the helper it calls, in the browser artifact, including when the hook
 * calls the same helper or import for a different purpose.
 */
type ElisionReason =
  /** The site binds a name the hooks' closure already owns. */
  | "closure-member"
  /** A hoisted `var` whose initialiser evaluates only that closure. */
  | "closure-only-evaluation"
  /** The declaration runs nothing at module load. */
  | "does-not-run";

/** Names whose reads cannot fail before this site starts evaluating. */
function initializedNamesBefore(node: Node, sites: BindingSite[]): Set<string> {
  const initialized = new Set<string>();
  const siteStart = nodeStart(node);

  for (const candidate of sites) {
    const candidateEnd = nodeEnd(candidate.node);
    const initializedAtInstantiation = candidate.initialization === "instantiation";
    const evaluatedEarlier = siteStart !== null && candidateEnd !== null &&
      candidateEnd < siteStart;
    if (!initializedAtInstantiation && !evaluatedEarlier) continue;
    for (const name of candidate.names) initialized.add(name);
  }

  return initialized;
}

function initializedNamesAt(site: BindingSite, sites: BindingSite[]): Set<string> {
  return initializedNamesBefore(site.node, sites);
}

function elisionReason(
  site: BindingSite,
  hookClosure: ReadonlySet<string>,
  helpers: ReadonlySet<string>,
  initializedNames: ReadonlySet<string>,
): ElisionReason | null {
  if (site.names.some((name) => hookClosure.has(name))) return "closure-member";
  if (evaluationIsInert(site.node, helpers, initializedNames)) return "does-not-run";
  if (site.nested && [...site.references].every((name) => hookClosure.has(name))) {
    return "closure-only-evaluation";
  }
  return null;
}

/**
 * The dead declarations this pass is entitled to remove: the ones still holding
 * on to the hooks' dependency closure.
 *
 * Reachability finds every dead declaration, but removing all of them would
 * make this stage a general dead-code eliminator and take unrelated client code
 * with it. What it must remove is narrower and forced: a dead declaration that
 * reads a hook-closure binding is precisely what keeps a secret and its import
 * in the browser artifact, and once it goes, every dead declaration that read
 * *it* has to go too or the output references a binding that is no longer
 * there. So the set grows outwards from the closure until it stops.
 */
function serverTaintedSites(
  dead: BindingSite[],
  hookClosure: ReadonlySet<string>,
): Set<BindingSite> {
  const tainted = new Set<BindingSite>();
  const taintedNames = new Set<string>();
  const touched = (name: string): boolean => hookClosure.has(name) || taintedNames.has(name);

  for (let grew = true; grew;) {
    grew = false;
    for (const site of dead) {
      if (tainted.has(site)) continue;
      if (!site.names.some(touched) && ![...site.references].some(touched)) continue;

      tainted.add(site);
      for (const name of site.names) taintedNames.add(name);
      grew = true;
    }
  }

  return tainted;
}

/**
 * The local names a surviving separate export declaration publishes.
 *
 * A separate export is a real browser consumer of the binding it names,
 * because whatever imports the module reads it, but `freeReferencedIdentifiers`
 * cannot see that. An `ExportSpecifier` resolves `local` against the synthetic
 * root scope, while `export default Page` also names an already-bound local.
 *
 * `BindingSite.exported` only compensates when the `export` keyword wraps the
 * declaration itself. Esbuild hoists every named export into one trailing
 * clause and leaves the declarations as plain `const`/`function` statements,
 * so no site is `exported` and nothing roots them. That is what made a surviving
 * `export const client = makeClient({ get: () => API_KEY })` look dead beside an
 * emptied hook, and fail the build over a secret the browser can plainly reach.
 *
 * A re-export (`export { x } from "./m"`) binds nothing here, so its specifiers
 * name no module binding and are skipped.
 */
function separateExportLocalNames(body: Node[]): Set<string> {
  const names = new Set<string>();

  for (const statement of body) {
    if (statement.type === "ExportDefaultDeclaration") {
      if (isNode(statement.declaration)) {
        for (const name of freeReferencedIdentifiers(statement.declaration)) names.add(name);
      }
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.exportKind === "type") continue;
    if (isNode(statement.source)) continue;

    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      if (!isNode(specifier)) continue;
      if (specifier.exportKind === "type") continue;
      const local = nodeName(specifier.local);
      if (local) names.add(local);
    }
  }

  return names;
}

/**
 * Drop the module-scope bindings the emptied server-only hooks closed over.
 *
 * Liveness is reachability from the code that survives, not "is this name
 * mentioned elsewhere". The roots are what the module still *evaluates* once
 * every declaration that merely introduces a name is elided: surviving
 * exports, the client component and any side-effectful top-level statement,
 * minus the bodies that run only when something calls them. The edges are
 * genuine reads, deferred ones included, so a binding the browser can still
 * reach keeps everything its callbacks read. Anything the roots cannot reach
 * is dead.
 *
 * Elision and removal are scoped differently on purpose. Declarations that do
 * not run, plus nested hoisted `var` sites that evaluate only the hooks'
 * dependency closure, are elided from the roots because a dead declaration
 * must not be able to pin a secret: a private helper nothing calls used to be
 * treated as unconditionally live and kept `const KEY = getEnv(…)` and its
 * `node:crypto` import in the browser artifact. Removal stays scoped to the
 * closure, so an unrelated direct `const clientInit = bootClientAnalytics()`
 * keeps its side effect even if the hook calls the same binding, and a
 * hoisted `var` elided by that second rule is only cut when every binding it
 * evaluates is going away too, because `if (dev) { var d = boot(secret()) }`
 * is still client code when `boot` survives. Inside the closure the pass is exhaustive:
 * `const API_KEY = getEnv(...)` read only by `getServerData` goes, which is
 * what lets `dropUnusedImportBindings` drop the import next.
 *
 * Every binding name a removal takes out is added to `removedNames`, so the
 * caller can verify (fail closed) that none of them survives in the final
 * output. Two situations are reported back instead, and the caller stops the
 * build rather than shipping the value: a dead binding this pass cannot cut
 * out of the tree, and one that only a deferred body of a surviving
 * declaration reads, where there is nothing to cut and nothing safe to keep.
 */
function dropUnreachableModuleScopeBindings(
  body: Node[],
  sites: BindingSite[],
  hookClosure: ReadonlySet<string>,
  removeStatement: (statement: Node) => void,
  removedNames: Set<string>,
): Blocker[] {
  const nameHelpers = compilerNameHelperBindings(body);
  const reasons = new Map<BindingSite, ElisionReason>();
  for (const site of sites) {
    if (site.exported) continue;
    const reason = elisionReason(
      site,
      hookClosure,
      nameHelpers,
      initializedNamesAt(site, sites),
    );
    if (reason !== null) reasons.set(site, reason);
  }
  const elidable = sites.filter((site) => reasons.has(site));
  if (elidable.length === 0) return [];

  // Esbuild's generated name-registration call is metadata for the declaration
  // it names, not an independent browser consumer of it, so its *target* is
  // elided from the roots and the call is removed together with the
  // declaration. The call itself still reads the helper that performs it, which
  // stays alive for as long as any registration survives.
  const registrations = compilerNameRegistrations(body, nameHelpers);
  const elidableNames = new Set(elidable.flatMap((site) => site.names));
  const elided = new Set<Node>(elidable.map((site) => site.node));
  for (const registration of registrations) {
    if (elidableNames.has(registration.targetName)) elided.add(registration.target);
  }

  // A declaration roots what it *evaluates*, not everything written inside it.
  // The reads in a body that only runs when something calls it are edges of the
  // declaration's own binding, so they keep the secret alive exactly as long as
  // the browser can still reach that binding.
  const deferred = deferredExecutionNodes({ type: "Program", body }, sites);

  const roots = freeReferencedIdentifiers({ type: "Program", body }, elided, deferred);
  for (const site of sites) {
    if (site.exported) { for (const name of site.names) roots.add(name); }
  }
  // The same contract written through a separate export declaration, including
  // the trailing clause emitted by esbuild and raw `export default Page`.
  for (const name of separateExportLocalNames(body)) roots.add(name);

  // Every site carries edges, so an elided declaration the roots do reach still
  // keeps what it reads: `const shared = KEY.trim()` read by the client roots
  // `shared`, and `shared` roots `KEY` in turn.
  const reachable = reachableNames(roots, sites);
  const dead = elidable.filter((site) => site.names.every((name) => !reachable.has(name)));
  const tainted = serverTaintedSites(dead, hookClosure);
  const removable = dead.filter((site) => {
    if (!tainted.has(site)) return false;
    if (reasons.get(site) !== "closure-only-evaluation") return true;
    // This site's initialiser still runs. Eliding it from the roots only
    // stopped it vouching for what it calls. Cutting it out is justified only
    // when everything it evaluates is going away. If even one called binding
    // survives for browser code, deleting the whole initializer can delete an
    // observable client-side call; the blocked-path check below then fails
    // closed for any dead binding the surviving initializer still reads.
    return site.references.size > 0 &&
      [...site.references].every((name) => !reachable.has(name));
  });
  if (removable.length === 0) return [];

  // A name written down in more than one place is only safe to drop when every
  // one of its declarations goes, and only when each of them can be cut out
  // at all: a `for (var KEY of …)` head declares the binding the loop assigns
  // to and has no removable declaration.
  const removableSites = new Set(removable);
  const survivingNames = new Set(
    sites.filter((site) => !removableSites.has(site)).flatMap((site) => site.names),
  );

  const blocked: Blocker[] = [];
  for (const site of removable) {
    const shared = site.names.find((name) => survivingNames.has(name));
    if (shared) {
      blocked.push({
        reason: `\`${shared}\` is declared more than once and only one declaration is dead`,
        remedy: REMEDY.rewriteTheDeclaration,
      });
      continue;
    }
    if (site.remove === null) {
      blocked.push({
        reason: `\`${site.names[0]}\` is a dead server-only binding declared in a position ` +
          `this pass cannot remove`,
        remedy: REMEDY.rewriteTheDeclaration,
      });
    }
  }

  // A declaration the browser keeps, holding a read of a binding the browser
  // must not keep. The read is real but deferred (a callback body, a method,
  // an instance field), so it never rooted the binding, while the declaration
  // around it runs at module load and cannot be cut. Neither shipping the
  // secret nor emitting a reference to a binding that is gone is acceptable,
  // and choosing between them is the module author's call, not this pass's.
  const goingAway = new Set(removable.flatMap((site) => site.names));
  for (const site of sites) {
    if (removableSites.has(site)) continue;
    const held = [...site.references].find((name) => goingAway.has(name));
    if (held) {
      blocked.push({
        reason: `\`${held}\` is a server-only binding that nothing in the browser reaches, ` +
          `but \`${site.names[0]}\` still reads it from a body that runs only when ` +
          `it is called, and that declaration runs at module load`,
        remedy: REMEDY.separateTheValue,
      });
    }
  }
  if (blocked.length > 0) return blocked;

  for (const site of removable) {
    for (const name of site.names) removedNames.add(name);
    site.remove?.();
  }
  for (const registration of registrations) {
    if (removedNames.has(registration.targetName)) removeStatement(registration.statement);
  }

  return [];
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
 * What the author can do about a failure, chosen per failure class.
 *
 * The advice used to be one sentence appended to every message, telling the
 * author to declare the hook directly. That is the fix for an export form this
 * pass cannot follow, and nonsense for everything else: a module blocked over a
 * binding its client code still reads has already declared the hook directly,
 * and a missing parser extension is not the author's doing at all.
 */
const REMEDY = {
  /** The hook is exported in a form with no local declaration to empty. */
  declareDirectly: "Declare the hook directly (`export async function getServerData() {…}`) " +
    "so Veryfront can strip it from the client build.",
  /** The hook is fine; a value it shares with client code is the problem. */
  separateTheValue: "Move the shared value into a module the hook imports, or read it from code " +
    "the browser reaches so it is intentionally part of the client bundle.",
  /** The declaration form itself is what blocks the removal. */
  rewriteTheDeclaration:
    "Declare the value once, at the top level, so the stripped hook's state can " +
    "be removed from the client build.",
  /** Nothing about the module is wrong. */
  none: "",
} as const;

/** A removal this pass refused to make, with the advice that fits it. */
interface Blocker {
  reason: string;
  remedy: string;
}

/**
 * Raised when a module names a server-only export that this pass cannot remove.
 * Emitting the module anyway would put the loader, its imports and anything it
 * closes over into the browser bundle, so the build stops instead.
 */
class ServerExportStripError extends Error {
  constructor(
    filePath: string | undefined,
    reason: string,
    remedy: string = REMEDY.declareDirectly,
  ) {
    super(
      `Cannot remove the server-only export from ${filePath ?? "this module"} ` +
        `before it is sent to the browser: ${reason}.` + (remedy ? ` ${remedy}` : ""),
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
 * safe outcome: the alternative is shipping the loader to the browser.
 */
export async function stripServerOnlyExports(
  code: string,
  filePath?: string,
): Promise<string> {
  // Cheap pre-check: no mention of a hook means no parse.
  if (!SERVER_ONLY_EXPORTS.some((name) => code.includes(name))) return code;

  const parser = tryResolve<CodeParser>("CodeParser");
  if (!parser) {
    throw new ServerExportStripError(
      filePath,
      "no CodeParser extension is registered",
      REMEDY.none,
    );
  }

  let body: Node[];
  let ast: ASTNode;
  let stubs: Stubs;

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
      REMEDY.none,
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
  const hookSeed = hookReferencedIdentifiers(body, locals);

  // Fail closed on a hook this pass identified but could not stub: a class
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
  //
  // The hooks' dependency closure is itself a reachability question: a helper
  // the hook reaches only through another helper belongs to it just as much,
  // so it is grown over the same binding graph the pruning walks.
  const removedNames = new Set<string>();
  const removableStatements = new Set<Node>();
  const sites = moduleScopeBindingSites(body, stubs, (statement) => {
    removableStatements.add(statement);
  });
  const moduleBindings = new Set(sites.flatMap((site) => site.names));
  for (const statement of body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const binding of importedBindings(statement)) moduleBindings.add(binding);
  }
  // Free globals are not part of the hook's removable closure. If both the
  // hook and an unrelated client initializer call `console`, for example,
  // their shared global name must not make the client side effect server-tainted.
  const hookClosure = new Set(
    [...reachableNames(hookSeed, sites)].filter((name) => moduleBindings.has(name)),
  );
  const [firstBlocked] = dropUnreachableModuleScopeBindings(
    body,
    sites,
    hookClosure,
    (statement) => removableStatements.add(statement),
    removedNames,
  );
  if (firstBlocked) {
    throw new ServerExportStripError(filePath, firstBlocked.reason, firstBlocked.remedy);
  }

  const pruned = body.filter((statement) => !removableStatements.has(statement));
  const finalBody = dropUnusedImportBindings(pruned, hookClosure, removedNames);

  setBody(ast, finalBody);

  const generated = await parser.generate(ast);

  // Fail-closed output verification, run against the artifact itself: the
  // emitted code is re-parsed and scanned for every binding this pass decided
  // to drop, as an import or as a reference. Checking the freshly parsed
  // output (not the tree the nodes were structurally deleted from) means a
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
        REMEDY.none,
      );
    }

    const residual = freeReferencedIdentifiers({ type: "Program", body: emittedBody });
    for (const binding of moduleScopeBindingNames(emittedBody)) residual.add(binding);
    // A `var` below the top level binds module scope too, so a declaration that
    // survived inside a block must count as a leak just like a top-level one.
    for (const binding of hoistedVarNames(emittedBody)) residual.add(binding);
    for (const statement of emittedBody) {
      if (statement.type !== "ImportDeclaration") continue;
      for (const binding of importedBindings(statement)) residual.add(binding);
    }
    const leaked = [...removedNames].filter((name) => residual.has(name));
    if (leaked.length > 0) {
      throw new ServerExportStripError(
        filePath,
        `the server-only binding \`${leaked[0]}\` still appears in the stripped output`,
        REMEDY.none,
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
