/**
 * SSR Import Rewriter
 *
 * Shared utilities for rewriting imports in SSR context.
 * Transforms bare imports to esm.sh URLs and handles path aliases.
 */

import { REACT_VERSION } from "@veryfront/transforms/esm/package-registry.ts";

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

/**
 * Check if a specifier should be kept as-is (not rewritten to esm.sh).
 */
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

  // Keep React as bare specifiers - deno.json resolves to npm:react
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

/**
 * Transform bare imports to esm.sh URLs for SSR.
 * Keeps React, react-dom, and veryfront/* as bare specifiers.
 */
function rewriteBareImports(code: string): string {
  return code.replace(
    /from\s+["']([^"'./][^"']*)["']/g,
    (_match, specifier) => {
      if (shouldKeepBareSpecifier(specifier)) {
        return `from "${specifier}"`;
      }
      // Other packages go to esm.sh with ?deps to pin React version
      return `from "https://esm.sh/${specifier}?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}&target=es2022"`;
    },
  );
}

/**
 * Transform @/ path aliases to /_vf_modules/ URLs for SSR.
 */
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

/**
 * Add SSR params to relative imports.
 */
function rewriteRelativeImports(code: string, options: SSRRewriteOptions): string {
  const { projectSlug, branch, cacheBuster = Date.now() } = options;
  const projectParam = projectSlug ? `&project=${projectSlug}` : "";
  const branchParam = branch ? `&branch=${branch}` : "";

  return code.replace(
    /from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g,
    (_match, path) => `from "${path}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`,
  );
}

/**
 * Apply all SSR import rewrites to transformed code.
 *
 * This applies three transformations:
 * 1. Bare imports (lodash, @tanstack/react-query) -> esm.sh URLs
 * 2. @/ path aliases -> /_vf_modules/ URLs with SSR params
 * 3. Relative imports -> add ?ssr=true and cache buster
 */
export function applySSRImportRewrites(code: string, options: SSRRewriteOptions = {}): string {
  let result = rewriteBareImports(code);
  result = rewritePathAliases(result, options);
  result = rewriteRelativeImports(result, options);
  return result;
}
