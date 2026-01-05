import type { ImportMapConfig } from "./types.ts";
import {
  getContextPackageImportMap,
} from "../../build/transforms/esm/package-registry.ts";

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
 * React is NOT included here - it's resolved via deno.json import map (npm:react).
 * This ensures user code uses the same React instance as react-dom/server.
 *
 * Context packages use esm.sh with ?external=react, so they'll use whatever
 * React is available at runtime (npm:react on SSR, esm.sh/react on browser).
 */
export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: {
      // Veryfront exports - local resolution
      ...getVeryfrontSsrImportMap(),
      // Context packages from esm.sh with ?external=react
      // They'll use npm:react at runtime (from deno.json import map)
      ...getContextPackageImportMap(),
    },
  };
}
