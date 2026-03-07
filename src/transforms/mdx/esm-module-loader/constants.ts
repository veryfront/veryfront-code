import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";

// Re-export shared patterns for backwards compatibility
export {
  JSX_IMPORT_PATTERN,
  MODULE_EXTENSIONS,
  MODULE_SERVER_IMPORT_PATTERN,
  PROJECT_ALIAS_IMPORT_PATTERN,
  REACT_IMPORT_PATTERN,
  RELATIVE_IMPORT_PATTERN,
  UNRESOLVED_VF_MODULES_PATTERN,
  VF_MODULE_IMPORT_PATTERN,
} from "#veryfront/modules/loader-shared/patterns.ts";

export const IS_TRUE_NODE = (isNode || isBun) && !isDeno;

export const FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);

export const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";
export const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";

export const ESBUILD_JSX_FACTORY = "React.createElement";
export const ESBUILD_JSX_FRAGMENT = "React.Fragment";

export const DIRECTORY_PREFIXES = ["", "src/"];

export { HASH_SEED_FNV1A } from "#veryfront/utils/constants/hash.ts";
