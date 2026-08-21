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

function walk(node: unknown, visit: (node: Node) => void): void {
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
      continue;
    }
    if (typeof value === "object" && value !== null) walk(value, visit);
  }
}

function subtreeBindsReact(node: unknown): boolean {
  let found = false;
  walk(node, (current) => {
    if (current.type === "Identifier" && current.name === "React") found = true;
  });
  return found;
}

/**
 * True when `node` introduces a `React` binding.
 *
 * Declarator ids and parameters are searched as subtrees so a destructured
 * binding counts — `const [{ renderToString }, React] = await Promise.all(…)`
 * in the snippet renderer is a real binding and must not be re-imported over.
 * A type-only import is not a binding: it is erased before the JSX lowering
 * runs, which is one of the two ways this bug reached npm.
 */
function bindsReact(node: Node): boolean {
  if (node.type === "ImportDeclaration") {
    if (node.importKind === "type") return false;
    const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
    return specifiers.some((entry) => {
      if (!isNode(entry) || entry.importKind === "type") return false;
      const local = entry.local;
      return isNode(local) && local.type === "Identifier" &&
        local.name === "React";
    });
  }

  if (node.type === "VariableDeclarator") return subtreeBindsReact(node.id);

  if (
    node.type === "FunctionDeclaration" || node.type === "ClassDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    if (subtreeBindsReact(node.id)) return true;
    const params = Array.isArray(node.params) ? node.params : [];
    return params.some((param) => subtreeBindsReact(param));
  }

  return false;
}

/**
 * Returns the 1-based line of the first free `React` reference in `source`, or
 * `undefined` when the module has a binding or never mentions `React`.
 *
 * The check is parsed, not matched: `React.createElement` inside a string
 * literal or a comment is not a reference. The published package carries both —
 * `esm-module-loader/constants.js` holds the esbuild factory names as strings,
 * and the dev-ui extension embeds a whole browser bundle as one JSON string.
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

  let bound = false;
  let firstReference: number | undefined;

  walk(ast, (current) => {
    if (bindsReact(current)) bound = true;
    if (current.type !== "MemberExpression") return;
    const object = current.object;
    if (!isNode(object) || object.type !== "Identifier") return;
    if (object.name !== "React") return;
    const line = (current.loc as { start?: { line?: number } } | undefined)
      ?.start?.line ?? 1;
    if (firstReference === undefined || line < firstReference) {
      firstReference = line;
    }
  });

  return bound ? undefined : firstReference;
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
