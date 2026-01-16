import type { ImportMapConfig } from "./types.ts";

/**
 * Get veryfront/* import mappings for SSR.
 * These map to local exports to avoid esm.sh's Deno shim which fails in actual Deno.
 */
function getVeryfrontSsrImportMap(): Record<string, string> {
  return {
    "veryfront/head": "veryfront/head",
    "veryfront/router": "veryfront/router",
    "veryfront/context": "veryfront/context",
    "veryfront/fonts": "veryfront/fonts",
  };
}

/**
 * Get the default import map for SSR transforms.
 *
 * IMPORTANT: React is NOT included here intentionally.
 * The ESM loader keeps React as bare specifiers (externalized in bundleHttpImports),
 * so Deno resolves them via deno.json's import map. This ensures all React code
 * uses the same instance, preventing Symbol mismatches (React error #31).
 *
 * Projects can provide their own React version via their import map or veryfront.config.ts.
 */
export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: {
      ...getVeryfrontSsrImportMap(),
    },
  };
}
