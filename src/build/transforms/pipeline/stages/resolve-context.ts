/**
 * Resolve context stage - context packages → unified URLs.
 *
 * CRITICAL: This stage ensures SSR and browser resolve context-dependent packages
 * (like @tanstack/react-query) to IDENTICAL module instances, preventing
 * React context mismatch errors like "No QueryClient set".
 *
 * Uses package-registry.ts as single source of truth for package URLs.
 */

import { replaceSpecifiers } from "../../esm/lexer.ts";
import {
  CONTEXT_PACKAGE_NAMES,
  getContextPackageUrl,
  isContextPackage,
} from "../../esm/package-registry.ts";
import { TransformStage, type TransformContext, type TransformPlugin } from "../types.ts";

/**
 * Build import map from bare specifier to esm.sh URL for context packages.
 */
function buildContextImportMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pkg of CONTEXT_PACKAGE_NAMES) {
    map[pkg] = getContextPackageUrl(pkg);
  }
  return map;
}

/**
 * Resolve context plugin - ensures context packages resolve to unified URLs.
 *
 * This runs for BOTH SSR and browser to ensure identical module instances.
 * The package-registry.ts provides URLs that work in both environments.
 */
export const resolveContextPlugin: TransformPlugin = {
  name: "resolve-context",
  stage: TransformStage.RESOLVE_CONTEXT,

  async transform(ctx: TransformContext): Promise<string> {
    const importMap = buildContextImportMap();

    return await replaceSpecifiers(ctx.code, (specifier) => {
      // Check if this is a context package that needs unified resolution
      if (isContextPackage(specifier)) {
        return importMap[specifier] || null;
      }

      // Check if it's an esm.sh URL for a context package (normalize it)
      if (specifier.startsWith("https://esm.sh/")) {
        const packageName = extractPackageFromEsmSh(specifier);
        if (packageName && isContextPackage(packageName)) {
          // Return the canonical URL from our registry
          return importMap[packageName] || null;
        }
      }

      return null;
    });
  },
};

/**
 * Extract package name from esm.sh URL.
 * E.g., "https://esm.sh/@tanstack/react-query@5?external=react" -> "@tanstack/react-query"
 */
function extractPackageFromEsmSh(url: string): string | null {
  if (!url.startsWith("https://esm.sh/") && !url.startsWith("http://esm.sh/")) {
    return null;
  }

  // Remove protocol and host
  let path = url.replace(/^https?:\/\/esm\.sh\//, "");

  // Remove version prefix like /v135/
  path = path.replace(/^v\d+\//, "");

  // Handle scoped packages like @tanstack/react-query@5?external=...
  if (path.startsWith("@")) {
    const match = path.match(/^(@[^/]+\/[^@/?]+)/);
    return match?.[1] ?? null;
  } else {
    // Regular package: name@version or name?query
    const match = path.match(/^([^@/?]+)/);
    return match?.[1] ?? null;
  }
}

export default resolveContextPlugin;
