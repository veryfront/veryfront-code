/**
 * ESM Module Loader Constants
 *
 * Configuration constants for the MDX ESM module loading system.
 *
 * @module build/transforms/mdx/esm-module-loader/constants
 */

import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";

/** True Node.js-like runtime (Node.js or Bun, not Deno) that resolves bare imports from node_modules */
export const IS_TRUE_NODE = (isNode || isBun) && !isDeno;

/**
 * Framework root directory (veryfront-renderer/)
 * Computed from this file's location: src/transforms/mdx/esm-module-loader/constants.ts
 * Go up 4 levels to reach the framework root
 */
export const FRAMEWORK_ROOT = new URL("../../../..", import.meta.url).pathname;

/** Log prefix for MDX loader operations */
export const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";

/** Log prefix for MDX renderer operations */
export const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";

/** Pattern to match JS/TS file imports with file:// protocol */
export const JSX_IMPORT_PATTERN =
  /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(js|jsx|ts|tsx))['"];?/g;

/** Pattern to match React imports */
export const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;

/** Pattern for @/ aliased imports (project-relative paths) */
export const PROJECT_ALIAS_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]@\/([^'"]+)['"];?/g;

/** Pattern for /_vf_modules/ imports (browser-style module URLs) */
export const MODULE_SERVER_IMPORT_PATTERN = /from\s+["']\/?_vf_modules\/([^"']+)["']/g;

/** Pattern to match /_vf_modules/ imports with optional query params */
export const VF_MODULE_IMPORT_PATTERN = /from\s+["'](\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;

/** Pattern to match relative imports with optional query params */
export const RELATIVE_IMPORT_PATTERN = /from\s+["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;

/** Pattern to match unresolved /_vf_modules/ imports */
export const UNRESOLVED_VF_MODULES_PATTERN = /from\s+["'](\/?_vf_modules\/[^"']+)["']/g;

/** esbuild JSX factory function */
export const ESBUILD_JSX_FACTORY = "React.createElement";

/** esbuild JSX fragment function */
export const ESBUILD_JSX_FRAGMENT = "React.Fragment";

/** File extensions to try when resolving modules */
export const MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

/** Directory prefixes to try when resolving modules */
export const DIRECTORY_PREFIXES = ["", "src/"];

/** Directory prefixes to strip when resolving modules (for API storage compatibility) */
export const PREFIXES_TO_STRIP = ["components/", "pages/", "lib/", "app/"];

/** FNV-1a hash seed */
export const HASH_SEED_FNV1A = 2166136261;
