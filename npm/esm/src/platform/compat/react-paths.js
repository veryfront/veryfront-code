/**
 * Cross-runtime React path resolution.
 *
 * Provides consistent React module resolution for Bun/Node SSR.
 * This ensures the same React instance is used by both user components
 * and react-dom-server, preventing "Objects are not valid as a React child"
 * or "Cannot read properties of null (reading 'useState')" errors.
 *
 * @module
 */
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { isBun, isDeno, isNode } from "./runtime.js";
import { cwd } from "./process.js";
let localReactPathsCache = null;
const REACT_SPECIFIERS = [
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
];
function hasBunResolveSync() {
    return typeof Bun !== "undefined" && typeof Bun?.resolveSync === "function";
}
const IMPORT_META_RESOLVE_ERROR = "ImportMetaResolveUnavailable";
function resolveWithImportMeta(specifier, parentUrl) {
    const metaResolve = globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).resolve;
    if (typeof metaResolve !== "function") {
        const error = new Error("import.meta.resolve is required for Node ESM resolution (Node >= 22).");
        error.name = IMPORT_META_RESOLVE_ERROR;
        throw error;
    }
    try {
        return metaResolve(specifier, parentUrl);
    }
    catch {
        return null;
    }
}
function resolveReactSpecifier(specifier) {
    try {
        if (isBun && hasBunResolveSync() && Bun?.resolveSync) {
            const resolved = Bun.resolveSync(specifier, cwd());
            return `file://${resolved}`;
        }
        if (isNode) {
            // Use createRequire to resolve React from veryfront's node_modules.
            // import.meta.resolve's parentUrl argument doesn't work correctly in Node.js,
            // so we use createRequire which properly resolves from the specified path.
            const require = createRequire(globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url);
            const resolved = require.resolve(specifier);
            return pathToFileURL(resolved).href;
        }
    }
    catch {
        // Resolution failed, return undefined
    }
    return undefined;
}
export function getLocalReactPaths() {
    if (isDeno)
        return {};
    if (localReactPathsCache)
        return localReactPathsCache;
    const paths = {};
    for (const specifier of REACT_SPECIFIERS) {
        const resolved = resolveReactSpecifier(specifier);
        if (resolved)
            paths[specifier] = resolved;
    }
    localReactPathsCache = paths;
    return paths;
}
export function isReactSpecifier(specifier) {
    return (specifier === "react" ||
        specifier === "react-dom" ||
        specifier.startsWith("react/") ||
        specifier.startsWith("react-dom/"));
}
export function clearReactPathsCache() {
    localReactPathsCache = null;
}
