/**
 * Gives every emitted module that calls `React.createElement` a `React` binding.
 *
 * `deno.json` compiles this repo with `jsx: "react-jsx"` — the automatic
 * runtime — under which a component file needs no `React` import, and under
 * which `deno lint`'s `no-unused-vars` actively rejects one. `@deno/dnt@0.42.3`
 * does not agree and offers no say in the matter:
 *
 * ```ts
 * // jsr:@deno/dnt@0.42.3/mod.ts — not read from options.compilerOptions
 * jsx: ts.JsxEmit.React,
 * jsxFactory: "React.createElement",
 * jsxFragmentFactory: "React.Fragment",
 * ```
 *
 * So the published package is always lowered to the classic runtime, and any
 * `.tsx` that relied on the automatic one — or imported React as a type only,
 * which is erased — emits a module whose sole reference to `React` is a free
 * variable. It throws `ReferenceError: React is not defined` the first time SSR
 * renders it. `deno check`, the unit tests and `veryfront dev` all use the
 * automatic runtime, so none of the three can see it; the first observer is a
 * consumer getting an HTTP 500. Reported against the published `0.1.1246`,
 * where four modules shipped this way -- the builtin popover and drawer
 * adapters, and both optimized-image render helpers.
 *
 * The divergence cannot be closed in the sources without a `deno-lint-ignore`
 * on every component file, so it is closed here instead, on the artifact — the
 * one place where the classic lowering is a fact rather than an assumption.
 *
 * `@deno/dnt` 0.43 exposes `compilerOptions.jsx`. Once that bump lands and its
 * artifact diff has been reviewed, the build can emit the automatic runtime
 * directly and this normalization becomes a no-op — at which point it should be
 * kept as the assertion it already ends with, not deleted.
 */

import { parse } from "#babel/parser";
import { resolve } from "#std/path";

/** Prepended to any emitted module that needs the binding. */
const REACT_IMPORT = 'import * as React from "react";\n';

/**
 * Vendored third-party output. It arrives with its own React handling and must
 * not be rewritten.
 */
const SKIPPED_DIRECTORIES = new Set(["deps"]);

interface Node {
  type: string;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as Node).type === "string";
}

const FOR_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
]);

function eachChild(
  node: Node,
  visit: (child: unknown, key: string) => void,
): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      continue;
    }
    if (typeof value === "object" && value !== null) visit(value, key);
  }
}

/**
 * The names a binding pattern binds — and only those.
 *
 * Every position that is *read* rather than bound is skipped, because counting
 * one as a declaration silences the whole scope. A default value is the case
 * that bit: `function get(react = React)` binds `react` and *reads* `React`, so
 * collecting both makes the file look like it declares React. The emitted
 * `react/server-render-context.js` has exactly that signature twice.
 *
 * A computed destructuring key (`const { [React]: v } = o`) is likewise a read,
 * and is left for the reference walk to flag.
 */
function patternNames(node: unknown, out: Set<string>): void {
  if (!isNode(node)) return;

  switch (node.type) {
    case "Identifier":
      if (typeof node.name === "string") out.add(node.name);
      return;
    // Only the target binds; the default value on the right is a read.
    case "AssignmentPattern":
      patternNames(node.left, out);
      return;
    case "RestElement":
      patternNames(node.argument, out);
      return;
    case "ArrayPattern":
      for (const element of Array.isArray(node.elements) ? node.elements : []) {
        patternNames(element, out);
      }
      return;
    case "ObjectPattern":
      for (
        const property of Array.isArray(node.properties) ? node.properties : []
      ) {
        patternNames(property, out);
      }
      return;
    // The key names the source property; the value is the binding target.
    case "ObjectProperty":
      patternNames(node.value, out);
      return;
    default:
      return;
  }
}

/**
 * Adds every `var` name in `statements`, descending through nested blocks and
 * control flow but not into nested functions.
 *
 * `var` hoists to the enclosing function or module, so `if (x) { var React = … }`
 * declares React for the whole scope. Missing that is not a false negative but
 * something worse: the rewrite would prepend an import beside the `var` and Node
 * would refuse the file outright with "Identifier 'React' has already been
 * declared".
 */
function addHoistedVarNames(statements: unknown[], out: Set<string>): void {
  for (const statement of statements) {
    if (!isNode(statement)) continue;
    if (FUNCTION_TYPES.has(statement.type)) continue;

    if (
      statement.type === "VariableDeclaration" && statement.kind === "var"
    ) {
      const declarations = Array.isArray(statement.declarations)
        ? statement.declarations
        : [];
      for (const declarator of declarations) {
        if (isNode(declarator)) patternNames(declarator.id, out);
      }
      continue;
    }

    eachChild(statement, (child) => {
      if (isNode(child) && !FUNCTION_TYPES.has(child.type)) {
        addHoistedVarNames([child], out);
      }
    });
  }
}

function scopeBody(node: Node): unknown[] {
  if (node.type === "Program" || node.type === "BlockStatement") {
    return Array.isArray(node.body) ? node.body : [];
  }
  if (FUNCTION_TYPES.has(node.type)) {
    const body = node.body;
    if (
      isNode(body) && body.type === "BlockStatement" && Array.isArray(body.body)
    ) {
      return body.body;
    }
  }
  return [];
}

function addImportedNames(statement: Node, names: Set<string>): void {
  if (statement.importKind === "type") return;
  const specifiers = Array.isArray(statement.specifiers)
    ? statement.specifiers
    : [];
  for (const raw of specifiers) {
    if (!isNode(raw) || raw.importKind === "type") continue;
    const local = raw.local;
    if (isNode(local) && typeof local.name === "string") names.add(local.name);
  }
}

/**
 * Names this scope declares itself: parameters, imports, and the declarations
 * directly inside its body.
 *
 * Nested scopes are deliberately not descended into. A name declared inside a
 * nested function does not bind here, and treating it as though it did is what
 * lets a free reference escape — see `findFreeReactReference`.
 */
function declaredNames(node: Node): Set<string> {
  const names = new Set<string>();

  if (FUNCTION_TYPES.has(node.type)) {
    for (const param of Array.isArray(node.params) ? node.params : []) {
      patternNames(param, names);
    }
    const id = node.id;
    if (isNode(id) && typeof id.name === "string") names.add(id.name);
  }

  if (node.type === "CatchClause") patternNames(node.param, names);

  // `for (const React of list)` binds React for the head and the body.
  if (FOR_TYPES.has(node.type)) {
    const head = node.type === "ForStatement" ? node.init : node.left;
    if (isNode(head) && head.type === "VariableDeclaration") {
      const declarations = Array.isArray(head.declarations)
        ? head.declarations
        : [];
      for (const declarator of declarations) {
        if (isNode(declarator)) patternNames(declarator.id, names);
      }
    }
  }

  for (const entry of scopeBody(node)) {
    if (!isNode(entry)) continue;

    if (entry.type === "ImportDeclaration") {
      addImportedNames(entry, names);
      continue;
    }

    // `export const X = …` and `export function X()` declare X locally too.
    const statement = entry.type === "ExportNamedDeclaration" ||
        entry.type === "ExportDefaultDeclaration"
      ? entry.declaration
      : entry;
    if (!isNode(statement)) continue;

    if (statement.type === "VariableDeclaration") {
      const declarations = Array.isArray(statement.declarations)
        ? statement.declarations
        : [];
      for (const declarator of declarations) {
        if (isNode(declarator)) patternNames(declarator.id, names);
      }
      continue;
    }

    if (
      statement.type === "FunctionDeclaration" ||
      statement.type === "ClassDeclaration"
    ) {
      const id = statement.id;
      if (isNode(id) && typeof id.name === "string") names.add(id.name);
    }
  }

  if (node.type === "Program" || FUNCTION_TYPES.has(node.type)) {
    addHoistedVarNames(scopeBody(node), names);
  }

  return names;
}

/**
 * True when this `React` identifier names something rather than reads it: an
 * import\'s local name, a declared name, a non-computed member property
 * (`foo.React`), or a non-computed object key (`{ React: 1 }`).
 */
function isNameNotReference(parent: Node, key: string): boolean {
  if (key === "local" || key === "id") return true;
  if (
    (parent.type === "MemberExpression" ||
      parent.type === "OptionalMemberExpression") &&
    key === "property" &&
    parent.computed !== true
  ) {
    return true;
  }
  return (parent.type === "ObjectProperty" || parent.type === "ObjectMethod") &&
    key === "key" && parent.computed !== true;
}

/**
 * Returns the 1-based line of the first `React` reference in `source` that
 * nothing binds, or `undefined` when the module is fine.
 *
 * Two things make this more than a search for `React.createElement`.
 *
 * It is parsed, not matched, so `React.createElement` inside a string literal
 * or a comment is not a reference. The published package carries both:
 * `esm-module-loader/constants.js` exports the esbuild factory names as
 * strings, and the dev-ui extension embeds a whole browser bundle as one JSON
 * string.
 *
 * And it is scope-aware in both directions. A module-scope binding satisfies
 * the whole file, since that is exactly what the rewrite would add. A binding
 * anywhere else only shadows references inside its own scope: `snippet-
 * renderer.js` binds React with `const [{ renderToString }, React] = await
 * Promise.all(…)` inside one function, which must not be taken to excuse a
 * free reference at module scope elsewhere in the same file.
 *
 * Any read of `React` counts, not just a member access, so
 * `React?.createElement`, `React["createElement"]` and a bare `React` passed as
 * a value are all caught.
 */
export function findFreeReactReference(
  source: string,
  file = "module.js",
): number | undefined {
  let ast: unknown;
  try {
    ast = parse(source, { sourceType: "module" });
  } catch (error) {
    throw new Error(
      `Failed to parse emitted module ${file}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isNode(ast)) return undefined;
  const program = isNode(ast.program) ? ast.program : ast;
  if (declaredNames(program).has("React")) return undefined;

  let firstFree: number | undefined;

  const visit = (
    node: unknown,
    parent: Node | undefined,
    key: string,
    shadowed: boolean,
  ): void => {
    if (!isNode(node)) return;

    const opensScope = node.type === "BlockStatement" ||
      node.type === "CatchClause" || FOR_TYPES.has(node.type) ||
      FUNCTION_TYPES.has(node.type);
    const inShadow = shadowed ||
      (opensScope && declaredNames(node).has("React"));

    if (
      !inShadow && node.type === "Identifier" && node.name === "React" &&
      parent && !isNameNotReference(parent, key)
    ) {
      const line =
        (node.loc as { start?: { line?: number } } | undefined)?.start?.line ??
          1;
      if (firstFree === undefined || line < firstFree) firstFree = line;
    }

    eachChild(
      node,
      (child, childKey) => visit(child, node, childKey, inShadow),
    );
  };

  visit(ast, undefined, "", false);
  return firstFree;
}

/** `source` with the React namespace import prepended. */
export function withReactBinding(source: string): string {
  return REACT_IMPORT + source;
}

async function* walkJavaScriptFiles(
  directory: string,
): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isDirectory) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* walkJavaScriptFiles(resolve(directory, entry.name));
    } else if (entry.isFile && /\.(?:c|m)?js$/.test(entry.name)) {
      yield resolve(directory, entry.name);
    }
  }
}

/**
 * Rewrites every module under `esmRoot` that references `React` freely, then
 * asserts none is left. Returns the paths patched, relative to `esmRoot`.
 */
export async function normalizeNpmJsxReactBinding(
  esmRoot: string,
): Promise<string[]> {
  const root = resolve(esmRoot);
  const patched: string[] = [];

  for await (const path of walkJavaScriptFiles(root)) {
    const source = await Deno.readTextFile(path);
    if (findFreeReactReference(source, path) === undefined) continue;
    await Deno.writeTextFile(path, withReactBinding(source));
    patched.push(path.slice(root.length + 1));
  }

  // The rewrite is the fix; this is the check. A module that still reads
  // `React` freely after being given the import means the detection missed a
  // shape, and shipping it is an HTTP 500 on someone's first render.
  const remaining: string[] = [];
  for await (const path of walkJavaScriptFiles(root)) {
    const line = findFreeReactReference(
      await Deno.readTextFile(path),
      path,
    );
    if (line !== undefined) {
      remaining.push(`${path.slice(root.length + 1)}:${line}`);
    }
  }

  if (remaining.length > 0) {
    throw new Error(
      `${remaining.length} emitted module(s) still reference \`React\` with no ` +
        `binding, and would throw \`ReferenceError: React is not defined\` at ` +
        `SSR:\n  ${remaining.join("\n  ")}`,
    );
  }

  patched.sort();
  return patched;
}
