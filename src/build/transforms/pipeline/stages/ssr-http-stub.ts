/**
 * SSR HTTP Stub Stage
 *
 * Replaces static HTTP URL imports with SSR-safe stubs during server-side rendering.
 * Browser-only modules (like video.js) fail when imported during SSR because they
 * access browser globals (document, window) at module-level.
 *
 * This stage:
 * 1. Detects static imports from HTTP URLs (esm.sh, unpkg, etc.)
 * 2. Replaces them with null/empty stubs during SSR
 * 3. Leaves browser transforms unchanged
 *
 * The client-side code keeps the original imports, ensuring proper hydration.
 */

import type { TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import { parseImports, rewriteImports } from "../../esm/lexer.ts";

/**
 * Check if a specifier is an HTTP URL import
 */
function isHttpImport(specifier: string | undefined): boolean {
  if (!specifier) return false;
  return specifier.startsWith("http://") || specifier.startsWith("https://");
}

/**
 * Check if a specifier is likely a browser-only module that needs stubbing
 * These are modules that have side effects or access browser globals at import time
 */
function isBrowserOnlyModule(specifier: string): boolean {
  // video.js and similar media libraries
  if (specifier.includes("video.js") || specifier.includes("video-js")) return true;
  if (specifier.includes("videojs")) return true;

  // Other known browser-only packages
  if (specifier.includes("gsap")) return true;
  if (specifier.includes("three")) return true;
  if (specifier.includes("mapbox")) return true;
  if (specifier.includes("leaflet")) return true;

  // Default: Don't stub - most packages work fine in SSR
  return false;
}

/**
 * Generate a stub for a given import statement
 */
function generateStub(imp: {
  n: string | undefined;
  ss: number;
  se: number;
  d: number;
}, statement: string): string | null {
  if (!imp.n || !isHttpImport(imp.n)) return null;
  if (!isBrowserOnlyModule(imp.n)) return null;

  // Don't stub dynamic imports - they're already deferred
  if (imp.d > -1) return null;

  // Parse the import clause to understand what's being imported
  // import X from 'url'
  // import { X, Y } from 'url'
  // import * as X from 'url'
  // import 'url' (side-effect)

  const trimmed = statement.trim();

  // Side-effect import: import 'url' -> // SSR stub: import 'url'
  if (/^import\s+['"`]/.test(trimmed)) {
    return `/* SSR stub: ${trimmed} */`;
  }

  // Extract what's between 'import' and 'from'
  const fromIndex = trimmed.lastIndexOf(" from ");
  if (fromIndex === -1) return null;

  const importClause = trimmed.slice(6, fromIndex).trim(); // Skip 'import '

  // Default import: import X from 'url' -> const X = null
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(importClause)) {
    return `const ${importClause} = null; /* SSR stub for ${imp.n} */`;
  }

  // Namespace import: import * as X from 'url' -> const X = {}
  const namespaceMatch = importClause.match(/^\*\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (namespaceMatch) {
    return `const ${namespaceMatch[1]} = {}; /* SSR stub for ${imp.n} */`;
  }

  // Named imports: import { X, Y as Z } from 'url' -> const X = null, Z = null
  const namedMatch = importClause.match(/^\{([^}]+)\}$/);
  if (namedMatch?.[1]) {
    const names = namedMatch[1].split(",").map((n) => {
      const parts = n.trim().split(/\s+as\s+/);
      return parts[parts.length - 1]?.trim() ?? "";
    });
    const stubs = names.map((n) => `${n} = null`).join(", ");
    return `const ${stubs}; /* SSR stub for ${imp.n} */`;
  }

  // Mixed import: import X, { Y } from 'url'
  const mixedMatch = importClause.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*\{([^}]+)\}$/);
  if (mixedMatch?.[1] && mixedMatch[2]) {
    const defaultName = mixedMatch[1];
    const names = mixedMatch[2].split(",").map((n) => {
      const parts = n.trim().split(/\s+as\s+/);
      return parts[parts.length - 1]?.trim() ?? "";
    });
    const allNames = [defaultName, ...names].map((n) => `${n} = null`).join(", ");
    return `const ${allNames}; /* SSR stub for ${imp.n} */`;
  }

  // Unknown pattern - don't modify
  return null;
}

export const ssrHttpStubPlugin: TransformPlugin = {
  name: "ssr-http-stub",
  stage: TransformStage.RESOLVE_CONTEXT + 1, // Run just after resolve-context, before resolve-relative

  // No condition needed - this plugin is only added to SSR_PIPELINE

  async transform(ctx) {
    const imports = await parseImports(ctx.code);

    // Check if any HTTP imports need stubbing
    const needsStubbing = imports.some(
      (imp) => imp.n && isHttpImport(imp.n) && isBrowserOnlyModule(imp.n) && imp.d === -1,
    );

    if (!needsStubbing) {
      return ctx.code;
    }

    // Rewrite browser-only HTTP imports to stubs
    return await rewriteImports(ctx.code, (imp, statement) =>
      generateStub(imp, statement)
    );
  },
};
