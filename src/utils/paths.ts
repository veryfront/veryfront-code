/**
 * Project directory paths and file extensions
 *
 * For internal veryfront URL endpoints, see ./constants/server.ts
 */

import {
  BUILD_DIRS,
  INTERNAL_ENDPOINTS,
  INTERNAL_PATH_PREFIXES,
  INTERNAL_PREFIX,
} from "./constants/server.ts";

export const PATHS = {
  PAGES_DIR: "pages",
  COMPONENTS_DIR: "components",
  PUBLIC_DIR: "public",
  STYLES_DIR: "styles",
  DIST_DIR: "dist",
  CONFIG_FILE: "veryfront.config.js",
} as const;

/**
 * @deprecated Use INTERNAL_PREFIX, INTERNAL_ENDPOINTS, INTERNAL_PATH_PREFIXES from ./constants/server.ts
 */
export const VERYFRONT_PATHS = {
  INTERNAL_PREFIX: INTERNAL_PREFIX,
  BUILD_DIR: BUILD_DIRS.ROOT,
  CHUNKS_DIR: BUILD_DIRS.CHUNKS,
  DATA_DIR: BUILD_DIRS.DATA,
  ASSETS_DIR: BUILD_DIRS.ASSETS,
  HMR_RUNTIME: INTERNAL_ENDPOINTS.HMR_RUNTIME,
  CLIENT_JS: INTERNAL_ENDPOINTS.CLIENT_JS,
  ROUTER_JS: INTERNAL_ENDPOINTS.ROUTER_JS,
  ERROR_OVERLAY: INTERNAL_ENDPOINTS.ERROR_OVERLAY,
} as const;

export const FILE_EXTENSIONS = {
  MDX: [".mdx", ".md"],
  SCRIPT: [".tsx", ".ts", ".jsx", ".js"],
  STYLE: [".css", ".scss", ".sass"],
  ALL: [".mdx", ".md", ".tsx", ".ts", ".jsx", ".js", ".css"],
} as const;

// Re-export for convenience
export { BUILD_DIRS, INTERNAL_ENDPOINTS, INTERNAL_PATH_PREFIXES, INTERNAL_PREFIX };
