export const PATHS = {
  PAGES_DIR: "pages",
  COMPONENTS_DIR: "components",
  PUBLIC_DIR: "public",
  STYLES_DIR: "styles",
  DIST_DIR: "dist",
  CONFIG_FILE: "veryfront.config.js",
} as const;

export const VERYFRONT_PATHS = {
  INTERNAL_PREFIX: "/_veryfront",
  BUILD_DIR: "_veryfront",
  CHUNKS_DIR: "_veryfront/chunks",
  DATA_DIR: "_veryfront/data",
  ASSETS_DIR: "_veryfront/assets",
  HMR_RUNTIME: "/_veryfront/hmr-runtime.js",
  CLIENT_JS: "/_veryfront/client.js",
  ROUTER_JS: "/_veryfront/router.js",
  ERROR_OVERLAY: "/_veryfront/error-overlay.js",
} as const;

export const FILE_EXTENSIONS = {
  MDX: [".mdx", ".md"],
  SCRIPT: [".tsx", ".ts", ".jsx", ".js"],
  STYLE: [".css", ".scss", ".sass"],
  ALL: [".mdx", ".md", ".tsx", ".ts", ".jsx", ".js", ".css"],
} as const;
