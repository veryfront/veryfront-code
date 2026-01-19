import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import { getReactImportMap, REACT_VERSION } from "@veryfront/transforms/esm/package-registry.ts";

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
  // Skip if already has protocol prefix
  if (
    specifier.startsWith("npm:") ||
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("file://") ||
    specifier.startsWith("node:")
  ) {
    return true;
  }

  // Skip @/ path aliases - handled separately
  if (specifier.startsWith("@/")) {
    return true;
  }

  // Keep React as bare specifiers - deno.json resolves to esm.sh
  // This ensures same React instance as react-dom/server
  if (specifier === "react" || specifier.startsWith("react/")) {
    return true;
  }
  if (specifier === "react-dom" || specifier.startsWith("react-dom/")) {
    return true;
  }

  // Keep veryfront/* imports as bare specifiers for Deno to resolve via deno.json exports
  if (specifier.startsWith("veryfront/")) {
    return true;
  }

  return false;
}

function resolveReactForRuntime(specifier: string): string | null {
  if (isDeno) return null;

  const reactMap = getReactImportMap();
  if (reactMap[specifier]) {
    return reactMap[specifier]!;
  }
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
  return code.replace(
    /from\s+["']([^"'./][^"']*)["']/g,
    (_match, specifier) => {
      const reactUrl = resolveReactForRuntime(specifier);
      if (reactUrl) {
        return `from "${reactUrl}"`;
      }
      if (shouldKeepBareSpecifier(specifier)) {
        return `from "${specifier}"`;
      }
      // Other packages go to esm.sh with ?deps to pin React version
      return `from "https://esm.sh/${specifier}?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}&target=es2022"`;
    },
  );
}

function rewritePathAliases(code: string, options: SSRRewriteOptions): string {
  const { projectSlug, branch, cacheBuster = Date.now(), crossProjectRef } = options;
  const projectParam = projectSlug ? `&project=${projectSlug}` : "";
  const branchParam = branch ? `&branch=${branch}` : "";

  // For cross-project imports, @/ paths resolve to the external project
  if (crossProjectRef) {
    return code.replace(
      /from\s+["']@\/([^"']+)["']/g,
      (_match, path) => {
        const jsPath = path.endsWith(".js") ? path : `${path}.js`;
        return `from "/_vf_modules/_cross/${crossProjectRef}/@/${jsPath}?ssr=true&v=${cacheBuster}"`;
      },
    );
  }

  // Regular @/ paths resolve to current project
  return code.replace(
    /from\s+["']@\/([^"']+)["']/g,
    (_match, path) => {
      const jsPath = path.endsWith(".js") ? path : `${path}.js`;
      return `from "/_vf_modules/${jsPath}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`;
    },
  );
}

function rewriteRelativeImports(code: string, options: SSRRewriteOptions): string {
  const { projectSlug, branch, cacheBuster = Date.now() } = options;
  const projectParam = projectSlug ? `&project=${projectSlug}` : "";
  const branchParam = branch ? `&branch=${branch}` : "";

  return code.replace(
    /from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g,
    (_match, path) => `from "${path}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`,
  );
}

export function applySSRImportRewrites(code: string, options: SSRRewriteOptions = {}): string {
  let result = rewriteBareImports(code);
  result = rewritePathAliases(result, options);
  result = rewriteRelativeImports(result, options);
  return result;
}
