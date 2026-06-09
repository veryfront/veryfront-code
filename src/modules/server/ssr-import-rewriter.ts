import {
  DEFAULT_REACT_VERSION,
  getReactImportMap,
} from "#veryfront/transforms/esm/package-registry.ts";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPaths } from "#veryfront/platform/compat/react-paths.ts";
import { hashString } from "#veryfront/cache/hash.ts";

interface SSRRewriteOptions {
  /** Project slug for multi-project routing */
  projectSlug?: string | null;
  /** Branch name for branch-aware routing */
  branch?: string | null;
  /**
   * Cache buster appended as `&v=` to rewritten module URLs. Defaults to a
   * content hash of the source so identical input produces identical output
   * (a per-call `Date.now()` would defeat all downstream caching). Pass an
   * explicit value only when you need a different invalidation key.
   */
  cacheBuster?: number | string;
  /** Cross-project reference (e.g., "demo@0.0") for @/ path rewrites */
  crossProjectRef?: string;
  /** React version to use for import rewrites */
  reactVersion?: string;
}

function shouldKeepBareSpecifier(specifier: string): boolean {
  // npm: specifiers are only supported in Deno, not Node.js
  // In Node.js, we need to convert them to esm.sh URLs (handled in rewriteBareImports)
  if (specifier.startsWith("npm:")) return isDeno;

  if (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("file://") ||
    specifier.startsWith("node:")
  ) {
    return true;
  }

  if (specifier.startsWith("@/")) return true;
  if (specifier.startsWith("veryfront/")) return true;

  return false;
}

function resolveReactForRuntime(specifier: string, version?: string): string | null {
  // For Bun: Use local React paths from veryfront's node_modules.
  // Bun handles CJS/ESM interop correctly with file:// URLs.
  if (!isDeno && !isNode) {
    const localPath = getLocalReactPaths()[specifier];
    if (localPath) return localPath;
    // If not found in local paths, fall through to esm.sh for subpath imports
  }

  // For Deno: Use esm.sh URLs (Deno supports HTTP imports natively).
  // For Node.js: Use esm.sh URLs which will be cached to disk by cacheHttpImportsToLocal.
  // The cached bundles are ESM-compatible and can be imported via file:// URLs.
  const v = version ?? DEFAULT_REACT_VERSION;
  const mapped = getReactImportMap(v)[specifier];
  if (mapped) return mapped;

  if (specifier.startsWith("react/")) {
    const subpath = specifier.slice("react/".length);
    return `https://esm.sh/react@${v}/${subpath}?external=react&target=es2022`;
  }

  if (specifier.startsWith("react-dom/")) {
    const subpath = specifier.slice("react-dom/".length);
    return `https://esm.sh/react-dom@${v}/${subpath}?external=react&target=es2022`;
  }

  return null;
}

function rewriteBareImports(code: string, version?: string): string {
  const v = version ?? DEFAULT_REACT_VERSION;

  return code.replace(/from\s+["']([^"'./][^"']*)["']/g, (_match, specifier: string) => {
    const bareSpecifier = specifier.startsWith("npm:") ? specifier.slice(4) : specifier;

    const reactUrl = resolveReactForRuntime(bareSpecifier, v);
    if (reactUrl) return `from "${reactUrl}"`;

    if (shouldKeepBareSpecifier(specifier)) return `from "${specifier}"`;

    return `from "https://esm.sh/${bareSpecifier}?external=react&target=es2022"`;
  });
}

function rewritePathAliases(code: string, options: SSRRewriteOptions): string {
  const { projectSlug, branch, cacheBuster = hashString(code), crossProjectRef } = options;
  const projectParam = projectSlug ? `&project=${projectSlug}` : "";
  const branchParam = branch ? `&branch=${branch}` : "";

  return code.replace(/from\s+["']@\/([^"']+)["']/g, (_match, path: string) => {
    const jsPath = path.endsWith(".js") ? path : `${path}.js`;

    if (crossProjectRef) {
      return `from "/_vf_modules/_cross/${crossProjectRef}/@/${jsPath}?ssr=true&v=${cacheBuster}"`;
    }

    return `from "/_vf_modules/${jsPath}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`;
  });
}

function rewriteRelativeImports(code: string, options: SSRRewriteOptions): string {
  const { projectSlug, branch, cacheBuster = hashString(code) } = options;
  const projectParam = projectSlug ? `&project=${projectSlug}` : "";
  const branchParam = branch ? `&branch=${branch}` : "";

  return code.replace(/from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g, (_match, path: string) => {
    return `from "${path}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`;
  });
}

export function applySSRImportRewrites(code: string, options: SSRRewriteOptions = {}): string {
  // Resolve the cache buster once from the original source so both rewrite
  // passes share a single deterministic token (content-derived by default).
  const cacheBuster = options.cacheBuster ?? hashString(code);
  const resolvedOptions: SSRRewriteOptions = { ...options, cacheBuster };

  let result = rewriteBareImports(code, options.reactVersion);
  result = rewritePathAliases(result, resolvedOptions);
  result = rewriteRelativeImports(result, resolvedOptions);
  return result;
}
