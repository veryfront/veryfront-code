
export { DEFAULT_PORT } from "@veryfront/config/defaults.ts";

export const DEFAULT_DASHBOARD_PORT = 3002;

export const INTERNAL_PREFIX = "/_veryfront" as const;

export const INTERNAL_PATH_PREFIXES = {
  RSC: `${INTERNAL_PREFIX}/rsc/`,
  FS: `${INTERNAL_PREFIX}/fs/`,
  MODULES: `${INTERNAL_PREFIX}/modules/`,
  PAGES: `${INTERNAL_PREFIX}/pages/`,
  DATA: `${INTERNAL_PREFIX}/data/`,
  LIB: `${INTERNAL_PREFIX}/lib/`,
  CHUNKS: `${INTERNAL_PREFIX}/chunks/`,
  CLIENT: `${INTERNAL_PREFIX}/client/`,
} as const;

export const INTERNAL_ENDPOINTS = {
  HMR_RUNTIME: `${INTERNAL_PREFIX}/hmr-runtime.js`,
  HMR: `${INTERNAL_PREFIX}/hmr.js`,
  HYDRATE: `${INTERNAL_PREFIX}/hydrate.js`,
  ERROR_OVERLAY: `${INTERNAL_PREFIX}/error-overlay.js`,
  DEV_LOADER: `${INTERNAL_PREFIX}/dev-loader.js`,
  CLIENT_LOG: `${INTERNAL_PREFIX}/log`,

  CLIENT_JS: `${INTERNAL_PREFIX}/client.js`,
  ROUTER_JS: `${INTERNAL_PREFIX}/router.js`,
  PREFETCH_JS: `${INTERNAL_PREFIX}/prefetch.js`,
  MANIFEST_JSON: `${INTERNAL_PREFIX}/manifest.json`,
  APP_JS: `${INTERNAL_PREFIX}/app.js`,

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

  LIB_AI_REACT: `${INTERNAL_PREFIX}/lib/ai/react.js`,
  LIB_AI_COMPONENTS: `${INTERNAL_PREFIX}/lib/ai/components.js`,
  LIB_AI_PRIMITIVES: `${INTERNAL_PREFIX}/lib/ai/primitives.js`,
} as const;

export const BUILD_DIRS = {
  ROOT: "_veryfront",
  CHUNKS: "_veryfront/chunks",
  DATA: "_veryfront/data",
  ASSETS: "_veryfront/assets",
} as const;

export const PROJECT_DIRS = {
  ROOT: ".veryfront",
  CACHE: ".veryfront/cache",
  KV: ".veryfront/kv",
  LOGS: ".veryfront/logs",
  TMP: ".veryfront/tmp",
} as const;

export const DEFAULT_CACHE_DIR = PROJECT_DIRS.CACHE;

export function isInternalEndpoint(pathname: string): boolean {
  return pathname.startsWith(INTERNAL_PREFIX + "/");
}

export function isStaticAsset(pathname: string): boolean {
  return pathname.includes(".") || isInternalEndpoint(pathname);
}

export function normalizeChunkPath(
  filename: string,
  basePath: string = INTERNAL_PATH_PREFIXES.CHUNKS,
): string {
  if (filename.startsWith("/")) {
    return filename;
  }
  return `${basePath.replace(/\/$/, "")}/${filename}`;
}

export const DEV_SERVER_ENDPOINTS = {
  HMR_RUNTIME: INTERNAL_ENDPOINTS.HMR_RUNTIME,
  ERROR_OVERLAY: INTERNAL_ENDPOINTS.ERROR_OVERLAY,
} as const;
