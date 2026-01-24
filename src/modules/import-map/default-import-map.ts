import type { ImportMapConfig } from "./types.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";

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
 * Get React import map for SSR in Deno.
 * Points to shared-*.ts files which cache and re-export a single React instance.
 * This is CRITICAL for preventing multiple React instances during SSR.
 */
export function getDenoReactImportMap(): Record<string, string> {
  const srcPath = `file://${FRAMEWORK_ROOT}src`;
  return {
    "react": `${srcPath}/react/shared-react.ts`,
    "react-dom": `${srcPath}/react/shared-react-dom.ts`,
    "react-dom/client": `${srcPath}/react/shared-react-dom-client.ts`,
    "react-dom/server": `${srcPath}/react/shared-react-dom-server.ts`,
    "react/jsx-runtime": `${srcPath}/react/shared-jsx-runtime.ts`,
    "react/jsx-dev-runtime": `${srcPath}/react/shared-jsx-dev-runtime.ts`,
    // Prefix match for any react/* subpath imports
    "react/": `${srcPath}/react/shared-react.ts`,
  };
}

/**
 * Get the default import map for SSR transforms.
 *
 * For Deno SSR: Points React to shared-*.ts files that ensure a single React instance.
 * For other runtimes: Uses esm.sh URLs with external=react.
 *
 * For remote projects (fetched via API), the project's deno.json won't be found,
 * so this default map provides the React mappings.
 */
export function getDefaultImportMap(): ImportMapConfig {
  // Use shared React files for Deno to ensure single instance
  const reactMap = isDeno ? getDenoReactImportMap() : getReactImportMap();
  const verifrontMap = getVeryfrontSsrImportMap();

  // For Deno SSR, add scopes so that esm.sh modules with external=react
  // resolve their bare `react` imports to our shared-*.ts files.
  // Without scopes, esm.sh's external=react creates bare imports that Deno
  // would resolve to esm.sh's own React, creating duplicate instances.
  const scopes = isDeno
    ? {
      // Any module from esm.sh should resolve react to our shared files
      "https://esm.sh/": getDenoReactImportMap(),
    }
    : undefined;

  return {
    imports: {
      ...verifrontMap,
      ...reactMap,
    },
    scopes,
  };
}
