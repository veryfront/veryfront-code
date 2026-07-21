/**
 * Browser Node-Builtin Imports Stage — converts named imports of Node built-ins
 * into namespace imports plus a destructure.
 *
 * Browser-bound imports of `node:*` are pointed at a noop polyfill whose whole
 * job, per its own documentation, is that "the import succeeds, and any actual
 * usage of the imported API fails at the call site, which surfaces the problem
 * clearly instead of a cryptic module resolution error".
 *
 * That contract cannot hold for a *named* import. ESM resolves named imports at
 * link time, so `import { createHash } from "node:crypto"` fails the whole
 * module graph before a line of it runs:
 *
 *     SyntaxError: The requested module '.../node-noop.js' does not provide an
 *     export named 'createHash'
 *
 * One leaked builtin therefore takes down hydration for the entire page, and the
 * error names the polyfill rather than the offending import.
 *
 * Rewriting to a namespace import restores the intended behaviour: linking
 * succeeds, the binding is `undefined`, and the failure happens where the API is
 * actually called. It also makes the two node-noop variants (source and compiled
 * binary, which export different names) behave identically.
 */

import type { TransformContext, TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import { rewriteImports } from "../../esm/lexer.ts";

const NAMESPACE_PREFIX = "__vf_node_builtin_";

/**
 * Pick a namespace prefix the module has never used. A source file is free to
 * declare or import `__vf_node_builtin_0` itself, and shadowing it would either
 * duplicate the binding or silently redirect the user's own one.
 *
 * Substring containment is the right test even though it over-matches: every
 * name we go on to generate starts with the prefix, so a module that never
 * mentions the prefix cannot collide with any of them. That keeps this cheap on
 * post-esbuild output, where parsing for real bindings is not an option.
 */
function pickNamespacePrefix(code: string): string {
  let prefix = NAMESPACE_PREFIX;
  while (code.includes(prefix)) prefix += "_";
  return prefix;
}

/** Split a named-import clause into `local: imported` destructure pairs. */
function toDestructurePairs(namedClause: string): string[] | null {
  const pairs: string[] = [];

  for (const rawPart of namedClause.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    const alias = part.match(/^([_$a-zA-Z][\w$]*)\s+as\s+([_$a-zA-Z][\w$]*)$/);
    if (alias?.[1] && alias[2]) {
      pairs.push(`${alias[1]}: ${alias[2]}`);
      continue;
    }

    if (/^[_$a-zA-Z][\w$]*$/.test(part)) {
      pairs.push(part);
      continue;
    }

    return null; // Unrecognised clause — leave the statement alone.
  }

  return pairs.length > 0 ? pairs : null;
}

/**
 * Rewrite `import { a, b as c } from "node:x"` to a namespace import plus a
 * destructure. Default and namespace imports already link successfully and are
 * left untouched.
 */
export async function rewriteNodeBuiltinNamedImports(code: string): Promise<string> {
  if (!code.includes("node:")) return code;

  let counter = 0;
  const prefix = pickNamespacePrefix(code);

  return await rewriteImports(code, (imp, statement) => {
    if (!imp.n?.startsWith("node:")) return null;
    if (imp.d > -1) return null; // dynamic import resolves lazily already
    if (!statement.startsWith("import")) return null;

    // The clause is everything between the `import` keyword and the specifier.
    // Take it from the lexer's own offsets rather than by searching for
    // " from ": esbuild emits `import{createHash as h}from"node:crypto";` when
    // the build is minified, and there is no such substring in it.
    const specifierStart = imp.s - imp.ss;
    if (specifierStart <= "import".length || specifierStart > statement.length) return null;

    const clause = statement
      .slice("import".length, specifierStart - 1) // -1 for the opening quote
      .replace(/\bfrom\s*$/, "")
      .trim();

    if (clause === "") return null; // side-effect-only import

    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (!namedMatch?.[1]) return null; // no named bindings

    const pairs = toDestructurePairs(namedMatch[1]);
    if (!pairs) return null;

    const namespace = `${prefix}${counter++}`;
    const source = JSON.stringify(imp.n);

    // Anything left of the named clause (a default binding) keeps its own import.
    const leading = clause.replace(/\{[^}]*\}/, "").replace(/,\s*$/, "").replace(/^\s*,/, "")
      .trim();

    const defaultImport = leading ? `import ${leading} from ${source};` : "";

    return `${defaultImport}import * as ${namespace} from ${source};` +
      `const { ${pairs.join(", ")} } = ${namespace};`;
  });
}

export const browserNodeBuiltinImportsPlugin: TransformPlugin = {
  name: "browser-node-builtin-imports",
  // Before import resolution, while the specifier is still `node:*`.
  stage: TransformStage.COMPILE + 0.7,
  condition: (ctx: TransformContext) => ctx.target === "browser",
  transform: (ctx: TransformContext) => rewriteNodeBuiltinNamedImports(ctx.code),
};
