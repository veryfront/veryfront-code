import { getDenoNpmReactMap, getReactVersion } from "../../transforms/esm/package-registry.js";
import { isDeno } from "../../platform/compat/runtime.js";
import { getLocalReactPaths } from "../../platform/compat/react-paths.js";
function shouldKeepBareSpecifier(specifier) {
    if (specifier.startsWith("npm:") ||
        specifier.startsWith("http://") ||
        specifier.startsWith("https://") ||
        specifier.startsWith("file://") ||
        specifier.startsWith("node:")) {
        return true;
    }
    if (specifier.startsWith("@/"))
        return true;
    // React imports are handled by resolveReactForRuntime - don't keep as bare specifiers
    // This ensures SSR modules use explicit URLs for React, avoiding multiple instances
    if (specifier.startsWith("veryfront/"))
        return true;
    return false;
}
function resolveReactForRuntime(specifier, version) {
    // Always rewrite React imports to explicit specifiers for SSR modules.
    // Dynamic imports from temp files don't have access to deno.json import map,
    // so we must use explicit specifiers to ensure a single React instance.
    // For Deno: use npm: specifiers (auto-deduplicated by Deno's npm cache)
    // For Node/Bun: use local node_modules paths
    const reactMap = isDeno ? getDenoNpmReactMap(version) : getLocalReactPaths();
    const mapped = reactMap[specifier];
    if (mapped)
        return mapped;
    // Handle React subpath imports not in the map
    const v = version ?? getReactVersion();
    if (specifier.startsWith("react/")) {
        const subpath = specifier.slice("react/".length);
        return isDeno ? `npm:react@${v}/${subpath}` : `react/${subpath}`;
    }
    if (specifier.startsWith("react-dom/")) {
        const subpath = specifier.slice("react-dom/".length);
        return isDeno ? `npm:react-dom@${v}/${subpath}` : `react-dom/${subpath}`;
    }
    return null;
}
function rewriteBareImports(code, version) {
    const v = version ?? getReactVersion();
    return code.replace(/from\s+["']([^"'./][^"']*)["']/g, (_match, specifier) => {
        const reactUrl = resolveReactForRuntime(specifier, v);
        if (reactUrl)
            return `from "${reactUrl}"`;
        if (shouldKeepBareSpecifier(specifier))
            return `from "${specifier}"`;
        // For third-party packages: Deno uses npm: specifiers, Node/Bun use esm.sh
        if (isDeno) {
            return `from "npm:${specifier}"`;
        }
        return `from "https://esm.sh/${specifier}?deps=react@${v},react-dom@${v}&target=es2022"`;
    });
}
function rewritePathAliases(code, options) {
    const { projectSlug, branch, cacheBuster = Date.now(), crossProjectRef } = options;
    const projectParam = projectSlug ? `&project=${projectSlug}` : "";
    const branchParam = branch ? `&branch=${branch}` : "";
    return code.replace(/from\s+["']@\/([^"']+)["']/g, (_match, path) => {
        const jsPath = path.endsWith(".js") ? path : `${path}.js`;
        if (crossProjectRef) {
            return `from "/_vf_modules/_cross/${crossProjectRef}/@/${jsPath}?ssr=true&v=${cacheBuster}"`;
        }
        return `from "/_vf_modules/${jsPath}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`;
    });
}
function rewriteRelativeImports(code, options) {
    const { projectSlug, branch, cacheBuster = Date.now() } = options;
    const projectParam = projectSlug ? `&project=${projectSlug}` : "";
    const branchParam = branch ? `&branch=${branch}` : "";
    return code.replace(/from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g, (_match, path) => `from "${path}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`);
}
export function applySSRImportRewrites(code, options = {}) {
    let result = rewriteBareImports(code, options.reactVersion);
    result = rewritePathAliases(result, options);
    result = rewriteRelativeImports(result, options);
    return result;
}
