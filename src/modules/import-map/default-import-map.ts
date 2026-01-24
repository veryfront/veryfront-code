import type { ImportMapConfig } from "./types.ts";

/**
 * Framework root directory (veryfront-renderer/)
 * Computed from this file's location: src/modules/import-map/default-import-map.ts
 * Go up 3 levels to reach the framework root
 */
const FRAMEWORK_ROOT = new URL("../../..", import.meta.url).pathname;

/**
 * Get veryfront/* import mappings for SSR.
 * These resolve to file:// URLs pointing to framework source files,
 * enabling dynamic imports without Deno import map support.
 */
function getVeryfrontSsrImportMap(): Record<string, string> {
  // Use file:// URLs so dynamic imports work without import map support
  const srcPath = `file://${FRAMEWORK_ROOT}src`;
  return {
    // Short-form aliases -> file:// paths
    "veryfront/head": `${srcPath}/react/components/Head.tsx`,
    "veryfront/router": `${srcPath}/react/router/index.ts`,
    "veryfront/context": `${srcPath}/react/context/index.ts`,
    "veryfront/fonts": `${srcPath}/react/fonts/index.ts`,
    // Full veryfront/react/* paths (used by lib/ re-exports)
    "veryfront/react/head": `${srcPath}/react/components/Head.tsx`,
    "veryfront/react/router": `${srcPath}/react/router/index.ts`,
    "veryfront/react/context": `${srcPath}/react/context/index.ts`,
    "veryfront/react/fonts": `${srcPath}/react/fonts/index.ts`,
  };
}

/**
 * Get the default import map for SSR transforms.
 *
 * IMPORTANT: React is NOT included here intentionally.
 * The transform pipeline rewrites React to esm.sh URLs for SSR, so import maps
 * do not apply to React in this path. This map stays focused on veryfront/*
 * aliases; projects can still override React via config when needed.
 */
export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: {
      ...getVeryfrontSsrImportMap(),
    },
  };
}
