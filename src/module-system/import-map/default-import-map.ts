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
 *
 * Uses esm.sh URLs (same as browser) to ensure identical module instances.
 * This prevents hydration errors caused by different module instances having
 * different React contexts (e.g., "No QueryClient set" error).
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
 *
 * Context packages use esm.sh URLs (same as browser) to ensure identical
 * module instances across SSR and client, preventing hydration errors.
 */
export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: {
      // Veryfront exports - local resolution
      ...getVeryfrontSsrImportMap(),
      // Context packages via esm.sh URLs (matches browser)
      ...getContextPackageImportMapSSR(),
    },
  };
}
