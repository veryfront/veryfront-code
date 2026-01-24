import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";

export const IS_TRUE_NODE = (isNode || isBun) && !isDeno;

export const FRAMEWORK_ROOT = new URL("../../../..", import.meta.url).pathname;

export const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";
export const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";

export const JSX_IMPORT_PATTERN =
  /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(js|jsx|ts|tsx))['"];?/g;

export const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;

export const PROJECT_ALIAS_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]@\/([^'"]+)['"];?/g;

export const MODULE_SERVER_IMPORT_PATTERN = /from\s+["']\/?_vf_modules\/([^"']+)["']/g;

export const VF_MODULE_IMPORT_PATTERN = /from\s+["'](\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;

export const RELATIVE_IMPORT_PATTERN = /from\s+["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;

export const UNRESOLVED_VF_MODULES_PATTERN = /from\s+["'](\/?_vf_modules\/[^"']+)["']/g;

export const ESBUILD_JSX_FACTORY = "React.createElement";
export const ESBUILD_JSX_FRAGMENT = "React.Fragment";

export const MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
export const DIRECTORY_PREFIXES = ["", "src/"];
export const PREFIXES_TO_STRIP = ["components/", "pages/", "lib/", "app/"];

export const HASH_SEED_FNV1A = 2166136261;
