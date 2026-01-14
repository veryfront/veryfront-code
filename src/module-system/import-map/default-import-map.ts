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
 * React is NOT included here - it's resolved via deno.json import map.
 */
export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: {
      ...getVeryfrontSsrImportMap(),
    },
  };
}
