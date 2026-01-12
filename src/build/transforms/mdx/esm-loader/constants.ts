/**
 * ESM Module Loader Constants
 *
 * Shared constants for the ESM module loading system.
 *
 * @module build/transforms/mdx/esm-loader/constants
 */

import { isDeno, isNode } from "@veryfront/platform/compat/runtime.ts";

/** True Node.js runtime (not Deno with Node.js compat) */
export const IS_TRUE_NODE = isNode && !isDeno;

/** Framework root directory (veryfront-renderer/) - computed from this file's location */
// From src/build/transforms/mdx/esm-loader/constants.ts, go up 5 levels
export const FRAMEWORK_ROOT = new URL("../../../../..", import.meta.url).pathname;

/** Log prefix for MDX loader operations */
export const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";

/** Log prefix for MDX renderer operations */
export const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";

/** Pattern for JSX/TSX file imports */
export const JSX_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(jsx|tsx))['"];?/g;

/** Pattern for React imports */
export const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;

/** Pattern for @/ aliased imports (project-relative paths) */
export const PROJECT_ALIAS_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]@\/([^'"]+)['"];?/g;

/** Pattern for /_vf_modules/ imports (browser-style module URLs) */
export const MODULE_SERVER_IMPORT_PATTERN = /from\s+["']\/?_vf_modules\/([^"']+)["']/g;

/** esbuild JSX factory function */
export const ESBUILD_JSX_FACTORY = "React.createElement";

/** esbuild JSX fragment function */
export const ESBUILD_JSX_FRAGMENT = "React.Fragment";

/** Source file extensions to try when resolving imports */
export const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

/** Directory prefixes to try when searching for files */
export const DIRECTORY_PREFIXES = ["", "src/"];

/** Prefixes to strip from paths when file not found (API may store without these) */
export const PREFIXES_TO_STRIP = ["components/", "pages/", "lib/", "app/"];
