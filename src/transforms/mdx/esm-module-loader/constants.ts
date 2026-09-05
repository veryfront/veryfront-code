import { join } from "#veryfront/compat/path";
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

/**
 * Roots holding framework source shipped in the npm package.
 *
 * `FRAMEWORK_ROOT` alone is not a framework-file test: a local project can live
 * beneath it (`projects/myproject/components/...`), and treating that project's
 * source as framework source reads it through the unbounded local filesystem
 * instead of the adapter that enforces the project source limits.
 */
const FRAMEWORK_SOURCE_ROOTS = [
  `${join(FRAMEWORK_ROOT, "src")}/`,
  `${join(FRAMEWORK_ROOT, "dist", "framework-src")}/`,
];

/** Whether `sourceFilePath` is framework source shipped in the npm package. */
export function isFrameworkSourceFile(sourceFilePath: string): boolean {
  return FRAMEWORK_SOURCE_ROOTS.some((root) => sourceFilePath.startsWith(root));
}

export const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";
export const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";

export const ESBUILD_JSX_FACTORY = "React.createElement";
export const ESBUILD_JSX_FRAGMENT = "React.Fragment";

export const DIRECTORY_PREFIXES = ["", "src/"];

export { HASH_SEED_FNV1A } from "#veryfront/utils/constants/hash.ts";
