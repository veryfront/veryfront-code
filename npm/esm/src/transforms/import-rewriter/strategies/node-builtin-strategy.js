/**
 * Node.js built-in module strategy.
 *
 * Priority: 0.5 (before React, since node: is clearly not an npm package)
 * Handles: node:async_hooks, node:fs, node:path, etc.
 *
 * For SSR: Keep as-is (Deno/Node resolve natively).
 * For browser: Replace with polyfill modules from src/platform/polyfills/.
 *
 * Known polyfills provide correct API shapes (e.g. AsyncLocalStorage no-op).
 * Unknown builtins map to a generic noop export so the import doesn't crash.
 */
/**
 * Known Node.js built-in → browser polyfill mapping.
 * Each entry points to a framework polyfill served via /_vf_modules/_veryfront/.
 */
const NODE_POLYFILL_MAP = {
    "node:async_hooks": "/_vf_modules/_veryfront/platform/polyfills/node-async-hooks.js",
};
/** Fallback for unmapped Node.js built-ins. */
const NODE_NOOP_URL = "/_vf_modules/_veryfront/platform/polyfills/node-noop.js";
export class NodeBuiltinStrategy {
    name = "node-builtin";
    priority = 0.5;
    matches(specifier, _ctx) {
        return specifier.startsWith("node:");
    }
    rewrite(info, ctx) {
        // SSR: Keep node: imports as-is (resolved by runtime)
        if (ctx.target === "ssr") {
            return { specifier: null };
        }
        // Browser: Replace with polyfill module
        const polyfill = NODE_POLYFILL_MAP[info.specifier] ?? NODE_NOOP_URL;
        return { specifier: polyfill };
    }
}
export const nodeBuiltinStrategy = new NodeBuiltinStrategy();
