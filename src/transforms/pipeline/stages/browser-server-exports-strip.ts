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
 * mode) it never drops an import, because it cannot prove the module is free of
 * side effects.
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
 * - An import whose bindings all fall out of use is reduced to a side-effect
 *   import rather than deleted, because this pass knows nothing about the
 *   top-level code of the module it points at. Node built-ins are the
 *   exception: in the browser they resolve to a noop polyfill, so there is no
 *   side effect to keep. This matches what esbuild does with an external
 *   import whose bindings go unused.
 *
 * Anything that cannot be parsed leaves the module exactly as it was.
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
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

/** Names this module exports from its own local declarations. */
function exportedLocalNames(body: Node[]): Set<string> {
  const names = new Set<string>();

  for (const statement of body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.exportKind === "type") continue;

    // `export { getServerData }` and `export { getServerData as data }`: the
    // local name is what a declaration in this module is called. The reverse,
    // `export { other as getServerData }`, exports `other` and must not touch
    // a same-named local.
    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      if (!isNode(specifier)) continue;
      if (specifier.exportKind === "type") continue;
      // A re-export (`export { x } from "./y"`) has no local declaration to
      // empty, so recording the name is harmless.
      const local = nodeName(specifier.local);
      if (local) names.add(local);
    }

    const declaration = statement.declaration;
    if (!isNode(declaration)) continue;

    const direct = nodeName(declaration.id);
    if (direct) names.add(direct);

    for (
      const declarator of Array.isArray(declaration.declarations) ? declaration.declarations : []
    ) {
      if (!isNode(declarator)) continue;
      const name = nodeName(declarator.id);
      if (name) names.add(name);
    }
  }

  return names;
}

/**
 * Empty the body of every exported server-only hook. Emptying rather than
 * deleting keeps the binding, so an export clause or re-export stays valid.
 */
function emptyServerOnlyHooks(
  body: Node[],
  exported: Set<string>,
  stubs: { body: Node; init: Node },
): boolean {
  const targets = SERVER_ONLY_EXPORTS.filter((name) => exported.has(name));
  if (targets.length === 0) return false;

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
        if (!name || !targets.includes(name)) continue;
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
        if (!name || !targets.includes(name)) continue;
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
 */
function referencedIdentifiers(body: Node[]): Set<string> {
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
        const name = nodeName(node);
        if (name) referenced.add(name);
      }

      return true;
    });
  }

  return referenced;
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
 * Reduce imports nothing references any more to side-effect imports, and drop
 * them outright when they point at a Node built-in.
 */
function dropUnusedImportBindings(body: Node[]): Node[] {
  const referenced = referencedIdentifiers(body);

  return body.filter((statement) => {
    if (statement.type !== "ImportDeclaration") return true;
    if (statement.importKind === "type") return true;

    const bindings = importedBindings(statement);
    // Already a side-effect import: nothing to drop.
    if (bindings.length === 0) return true;
    if (bindings.some((binding) => referenced.has(binding))) return true;

    const source = isNode(statement.source) ? statement.source.value : undefined;
    if (typeof source === "string" && source.startsWith("node:")) return false;

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
 * Empty the server-only hooks in `code` and drop the import bindings they were
 * the last user of. Returns `code` unchanged when there is nothing to do, when
 * no parser is registered, or when the module does not parse.
 */
export async function stripServerOnlyExports(code: string, filePath?: string): Promise<string> {
  // Cheap pre-check: no mention of a hook means no parse.
  if (!SERVER_ONLY_EXPORTS.some((name) => code.includes(name))) return code;

  const parser = tryResolve<CodeParser>("CodeParser");
  if (!parser) return code;

  try {
    const stubs = await parseStubs(parser);
    if (!stubs) return code;

    const ast = await parser.parse({ code, filePath: filePath ?? "module.tsx" });
    const body = bodyOf(ast);

    if (!emptyServerOnlyHooks(body, exportedLocalNames(body), stubs)) return code;

    setBody(ast, dropUnusedImportBindings(body));

    const generated = await parser.generate(ast);
    return generated.code;
  } catch (error) {
    logger.debug("Left the module unchanged", {
      filePath,
      reason: error instanceof Error ? error.message : String(error),
    });
    return code;
  }
}

export const browserServerExportsStripPlugin: TransformPlugin = {
  name: "browser-server-exports-strip",
  // After esbuild compile and CSS strip, before any import resolution, so the
  // dropped bindings are never rewritten or pre-fetched.
  stage: TransformStage.COMPILE + 0.6,
  condition: (ctx: TransformContext) => ctx.target === "browser",
  transform: (ctx: TransformContext) => stripServerOnlyExports(ctx.code, ctx.filePath),
};
