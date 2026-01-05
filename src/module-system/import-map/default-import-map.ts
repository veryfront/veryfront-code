import type { ImportMapConfig } from "./types.ts";
import {
  CONTEXT_PACKAGE_NAMES,
  getContextPackageUrlSSR,
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
 * Get context package import map for SSR.
 * Uses npm: specifiers so Deno resolves these locally.
 * This ensures React context packages use the same React instance as the app.
 */
function getContextPackageImportMapSSR(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pkg of CONTEXT_PACKAGE_NAMES) {
    map[pkg] = getContextPackageUrlSSR(pkg);
  }
  return map;
}

/**
 * Get the default import map for SSR transforms.
 *
 * React is NOT included here - it's resolved via deno.json import map.
 * Context packages use npm: specifiers so they use Deno's local resolution,
 * which shares the same React instance from deno.json's npm:react mapping.
 */
export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: {
      // Veryfront exports - local resolution
      ...getVeryfrontSsrImportMap(),
      // Context packages via npm: specifiers - Deno resolves locally
      // This ensures they use the same React from deno.json's npm:react
      ...getContextPackageImportMapSSR(),
    },
  };
}
