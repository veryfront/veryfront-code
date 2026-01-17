/**
 * SSR HTTP Stub Stage - replaces browser-only HTTP imports with stubs during SSR.
 * Modules like video.js access browser globals at import time and fail in SSR.
 */

import type { TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import { parseImports, rewriteImports } from "../../esm/lexer.ts";

/** Known browser-only packages that need SSR stubbing */
const BROWSER_ONLY_PATTERNS = [
  "video.js",
  "video-js",
  "videojs",
  "gsap",
  "three",
  "mapbox",
  "leaflet",
];

function isHttpImport(specifier: string | undefined): boolean {
  return !!specifier && (specifier.startsWith("http://") || specifier.startsWith("https://"));
}

function isBrowserOnlyModule(specifier: string): boolean {
  return BROWSER_ONLY_PATTERNS.some((pattern) => specifier.includes(pattern));
}

/** Generate a stub for a given import statement */
function generateStub(imp: {
  n: string | undefined;
  ss: number;
  se: number;
  d: number;
}, statement: string): string | null {
  if (!imp.n || !isHttpImport(imp.n) || !isBrowserOnlyModule(imp.n)) return null;
  if (imp.d > -1) return null; // Skip dynamic imports

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
    return await rewriteImports(ctx.code, (imp, statement) => generateStub(imp, statement));
  },
};
