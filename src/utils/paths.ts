import {
  BUILD_DIRS,
  INTERNAL_ENDPOINTS,
  INTERNAL_PATH_PREFIXES,
  INTERNAL_PREFIX,
} from "./constants/server.ts";
import { VERYFRONT_CONFIG_FILES } from "./constants/config-files.ts";

const CONFIG_FILES = Object.freeze([...VERYFRONT_CONFIG_FILES]);

export const PATHS = Object.freeze(
  {
    PAGES_DIR: "pages",
    COMPONENTS_DIR: "components",
    PUBLIC_DIR: "public",
    STYLES_DIR: "styles",
    DIST_DIR: "dist",
    /** @deprecated Use CONFIG_FILES to account for every supported module format. */
    CONFIG_FILE: CONFIG_FILES[0],
    CONFIG_FILES,
  } as const,
);

export const FILE_EXTENSIONS = Object.freeze(
  {
    MDX: Object.freeze([".mdx", ".md"]),
    SCRIPT: Object.freeze([".tsx", ".ts", ".jsx", ".js"]),
    STYLE: Object.freeze([".css", ".scss", ".sass"]),
    ALL: Object.freeze([".mdx", ".md", ".tsx", ".ts", ".jsx", ".js", ".css"]),
  } as const,
);

export { BUILD_DIRS, INTERNAL_ENDPOINTS, INTERNAL_PATH_PREFIXES, INTERNAL_PREFIX };
