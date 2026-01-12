/**
 * ESM Module Loader
 *
 * Re-exports from the original esm-module-loader.ts.
 * This module is being incrementally refactored.
 *
 * @module build/transforms/mdx/esm-loader
 */

// Re-export everything from the main implementation
export {
  clearESMDiskCache,
  clearModulePathCache,
  type ESMLoaderContext,
  hashString,
  invalidateModulePaths,
  loadModuleESM,
} from "../esm-module-loader.ts";

// Re-export extracted utilities
export { getLocalFs } from "./local-fs.ts";
export {
  DIRECTORY_PREFIXES,
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  FRAMEWORK_ROOT,
  IS_TRUE_NODE,
  JSX_IMPORT_PATTERN,
  LOG_PREFIX_MDX_LOADER,
  LOG_PREFIX_MDX_RENDERER,
  MODULE_SERVER_IMPORT_PATTERN,
  PREFIXES_TO_STRIP,
  PROJECT_ALIAS_IMPORT_PATTERN,
  REACT_IMPORT_PATTERN,
  SOURCE_EXTENSIONS,
} from "./constants.ts";
