import { getReactImportMap, REACT_VERSION } from "#veryfront/transforms/esm/package-registry.ts";

export interface SSRRewriteOptions {
  /** Project slug for multi-project routing */
  projectSlug?: string | null;
  /** Branch name for branch-aware routing */
  branch?: string | null;
  /** Cache buster timestamp */
  cacheBuster?: number;
  /** Cross-project reference (e.g., "demo@0.0") for @/ path rewrites */
  crossProjectRef?: string;
}

function shouldKeepBareSpecifier(specifier: string): boolean {
  if (
    specifier.startsWith("npm:") ||
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("file://") ||
    specifier.startsWith("node:")
  ) {
    return true;
  }

  if (specifier.startsWith("@/")) return true;

  // React imports are handled by resolveReactForRuntime - don't keep as bare specifiers
  // This ensures SSR modules use explicit URLs for React, avoiding multiple instances

  if (specifier.startsWith("veryfront/")) return true;

  return false;
}

function resolveReactForRuntime(specifier: string): string | null {
  // Always rewrite React imports to explicit URLs for SSR modules.
  // Dynamic imports from temp files don't have access to deno.json import map,
  // so we must use explicit URLs to ensure a single React instance.
  const reactMap = getReactImportMap();
  const mapped = reactMap[specifier];
  if (mapped) return mapped;

  if (specifier.startsWith("react/")) {
    const subpath = specifier.slice("react/".length);
    return `https://esm.sh/react@${REACT_VERSION}/${subpath}?target=es2022`;
  }

  if (specifier.startsWith("react-dom/")) {
    const subpath = specifier.slice("react-dom/".length);
    return `https://esm.sh/react-dom@${REACT_VERSION}/${subpath}?target=es2022`;
  }

  return null;
}

function rewriteBareImports(code: string): string {
  return code.replace(/from\s+["']([^"'./][^"']*)["']/g, (_match, specifier: string) => {
    const reactUrl = resolveReactForRuntime(specifier);
    if (reactUrl) return `from "${reactUrl}"`;
    if (shouldKeepBareSpecifier(specifier)) return `from "${specifier}"`;

    return `from "https://esm.sh/${specifier}?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}&target=es2022"`;
  });
}

function rewritePathAliases(code: string, options: SSRRewriteOptions): string {
  const { projectSlug, branch, cacheBuster = Date.now(), crossProjectRef } = options;
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
  const { projectSlug, branch, cacheBuster = Date.now() } = options;
  const projectParam = projectSlug ? `&project=${projectSlug}` : "";
  const branchParam = branch ? `&branch=${branch}` : "";

  return code.replace(
    /from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g,
    (_match, path: string) =>
      `from "${path}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`,
  );
}

export function applySSRImportRewrites(code: string, options: SSRRewriteOptions = {}): string {
  let result = rewriteBareImports(code);
  result = rewritePathAliases(result, options);
  result = rewriteRelativeImports(result, options);
  return result;
}
