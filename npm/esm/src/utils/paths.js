import { BUILD_DIRS, INTERNAL_ENDPOINTS, INTERNAL_PATH_PREFIXES, INTERNAL_PREFIX, } from "./constants/server.js";
export const PATHS = {
    PAGES_DIR: "pages",
    COMPONENTS_DIR: "components",
    PUBLIC_DIR: "public",
    STYLES_DIR: "styles",
    DIST_DIR: "dist",
    CONFIG_FILE: "veryfront.config.js",
};
export const FILE_EXTENSIONS = {
    MDX: [".mdx", ".md"],
    SCRIPT: [".tsx", ".ts", ".jsx", ".js"],
    STYLE: [".css", ".scss", ".sass"],
    ALL: [".mdx", ".md", ".tsx", ".ts", ".jsx", ".js", ".css"],
};
export { BUILD_DIRS, INTERNAL_ENDPOINTS, INTERNAL_PATH_PREFIXES, INTERNAL_PREFIX };
