import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";

const NODE_POLYFILL_MAP: Record<string, string> = {
  "node:async_hooks": "/_vf_modules/_veryfront/platform/polyfills/node-async-hooks.js",
};

/**
 * Whether a builtin resolves to a polyfill that implements it for real, rather
 * than to the noop.
 *
 * A real polyfill exports the names it is asked for, so a named import of it
 * links successfully and must be left exactly as written. Rewriting it to a
 * namespace import plus a destructure would move the binding out of link
 * position and into the module body, where it is no longer hoisted — which
 * breaks any cyclic module graph that reads it at evaluation time.
 */
export function hasRealBrowserPolyfill(specifier: string): boolean {
  return specifier in NODE_POLYFILL_MAP;
}

const NODE_NOOP_URL = "/_vf_modules/_veryfront/platform/polyfills/node-noop.js";

/**
 * Get all polyfill paths that need to be embedded for compiled binaries.
 * Used by tests and startup validation to ensure no polyfills are forgotten.
 */
export function getRequiredPolyfillPaths(): string[] {
  const paths = new Set<string>();

  // Add all explicit mappings
  for (const url of Object.values(NODE_POLYFILL_MAP)) {
    paths.add(normalizePolyfillPath(url));
  }

  // Add the noop fallback
  paths.add(normalizePolyfillPath(NODE_NOOP_URL));

  return [...paths];
}

/**
 * Normalize a polyfill URL to the path format used in EMBEDDED_POLYFILLS.
 * Strips /_vf_modules/ prefix and .js extension.
 */
function normalizePolyfillPath(url: string): string {
  return url
    .replace(/^\/_vf_modules\//, "")
    .replace(/\.js$/, "");
}

export class NodeBuiltinStrategy implements ImportRewriteStrategy {
  readonly name = "node-builtin";
  readonly priority = 0.5;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return specifier.startsWith("node:");
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (ctx.target === "ssr") return { specifier: null };
    return { specifier: NODE_POLYFILL_MAP[info.specifier] ?? NODE_NOOP_URL };
  }
}

export const nodeBuiltinStrategy = new NodeBuiltinStrategy();
