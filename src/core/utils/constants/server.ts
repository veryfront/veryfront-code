/**
 * Centralized server endpoints and paths registry
 *
 * All internal veryfront URLs should be defined here as the single source of truth.
 * This prevents hardcoding URLs across the codebase and makes refactoring easier.
 */

/** Default port for development dashboard */
export const DEFAULT_DASHBOARD_PORT = 3002;

/** Default port for veryfront server */
export const DEFAULT_PORT = 3000;

/** Internal URL prefix for all veryfront endpoints */
export const INTERNAL_PREFIX = "/_veryfront" as const;

/**
 * All internal veryfront URL path prefixes (directories)
 */
export const INTERNAL_PATH_PREFIXES = {
  /** React Server Components endpoints */
  RSC: `${INTERNAL_PREFIX}/rsc/`,
  /** File system access endpoints (base64 encoded paths) */
  FS: `${INTERNAL_PREFIX}/fs/`,
  /** Virtual module system */
  MODULES: `${INTERNAL_PREFIX}/modules/`,
  /** Generated page modules */
  PAGES: `${INTERNAL_PREFIX}/pages/`,
  /** Data JSON endpoints */
  DATA: `${INTERNAL_PREFIX}/data/`,
  /** Library modules (AI SDK, etc.) */
  LIB: `${INTERNAL_PREFIX}/lib/`,
  /** Chunk assets */
  CHUNKS: `${INTERNAL_PREFIX}/chunks/`,
  /** Client component modules */
  CLIENT: `${INTERNAL_PREFIX}/client/`,
} as const;

/**
 * Specific internal endpoint URLs
 */
export const INTERNAL_ENDPOINTS = {
  // Development endpoints
  HMR_RUNTIME: `${INTERNAL_PREFIX}/hmr-runtime.js`,
  HMR: `${INTERNAL_PREFIX}/hmr.js`,
  HYDRATE: `${INTERNAL_PREFIX}/hydrate.js`,
  ERROR_OVERLAY: `${INTERNAL_PREFIX}/error-overlay.js`,
  DEV_LOADER: `${INTERNAL_PREFIX}/dev-loader.js`,
  CLIENT_LOG: `${INTERNAL_PREFIX}/log`,

  // Production endpoints
  CLIENT_JS: `${INTERNAL_PREFIX}/client.js`,
  ROUTER_JS: `${INTERNAL_PREFIX}/router.js`,
  PREFETCH_JS: `${INTERNAL_PREFIX}/prefetch.js`,
  MANIFEST_JSON: `${INTERNAL_PREFIX}/manifest.json`,
  APP_JS: `${INTERNAL_PREFIX}/app.js`,

  // RSC endpoints
  RSC_CLIENT: `${INTERNAL_PREFIX}/rsc/client.js`,
  RSC_MANIFEST: `${INTERNAL_PREFIX}/rsc/manifest`,
  RSC_STREAM: `${INTERNAL_PREFIX}/rsc/stream`,
  RSC_PAYLOAD: `${INTERNAL_PREFIX}/rsc/payload`,
  RSC_RENDER: `${INTERNAL_PREFIX}/rsc/render`,
  RSC_PAGE: `${INTERNAL_PREFIX}/rsc/page`,
  RSC_MODULE: `${INTERNAL_PREFIX}/rsc/module`,
  RSC_DOM: `${INTERNAL_PREFIX}/rsc/dom.js`,
  RSC_HYDRATOR: `${INTERNAL_PREFIX}/rsc/hydrator.js`,
  RSC_HYDRATE_CLIENT: `${INTERNAL_PREFIX}/rsc/hydrate-client.js`,

  // Library module endpoints
  LIB_AI_REACT: `${INTERNAL_PREFIX}/lib/ai/react.js`,
  LIB_AI_COMPONENTS: `${INTERNAL_PREFIX}/lib/ai/components.js`,
  LIB_AI_PRIMITIVES: `${INTERNAL_PREFIX}/lib/ai/primitives.js`,
} as const;

/**
 * Build output directory paths (relative)
 */
export const BUILD_DIRS = {
  /** Main build output directory */
  ROOT: "_veryfront",
  /** Chunks directory */
  CHUNKS: "_veryfront/chunks",
  /** Data directory */
  DATA: "_veryfront/data",
  /** Assets directory */
  ASSETS: "_veryfront/assets",
} as const;

/**
 * Local project directory paths (relative to project root)
 * These are .gitignore'd directories for caching and temporary files
 */
export const PROJECT_DIRS = {
  /** Base veryfront internal directory */
  ROOT: ".veryfront",
  /** Cache directory for build artifacts, transforms, etc. */
  CACHE: ".veryfront/cache",
  /** KV store directory */
  KV: ".veryfront/kv",
  /** Log files directory */
  LOGS: ".veryfront/logs",
  /** Temporary files directory */
  TMP: ".veryfront/tmp",
} as const;

/** Default cache directory path */
export const DEFAULT_CACHE_DIR = PROJECT_DIRS.CACHE;

/**
 * Helper to check if a pathname is an internal veryfront endpoint
 */
export function isInternalEndpoint(pathname: string): boolean {
  return pathname.startsWith(INTERNAL_PREFIX + "/");
}

/**
 * Helper to check if a pathname is a static asset (has extension or is internal)
 */
export function isStaticAsset(pathname: string): boolean {
  return pathname.includes(".") || isInternalEndpoint(pathname);
}

/**
 * Normalize a chunk path to include the base prefix
 */
export function normalizeChunkPath(
  filename: string,
  basePath: string = INTERNAL_PATH_PREFIXES.CHUNKS,
): string {
  if (filename.startsWith("/")) {
    return filename;
  }
  return `${basePath.replace(/\/$/, "")}/${filename}`;
}

// Re-export for backward compatibility
export const DEV_SERVER_ENDPOINTS = {
  HMR_RUNTIME: INTERNAL_ENDPOINTS.HMR_RUNTIME,
  ERROR_OVERLAY: INTERNAL_ENDPOINTS.ERROR_OVERLAY,
} as const;
