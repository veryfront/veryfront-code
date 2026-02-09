/**
 * Shared constants, types, and caches for the SSR VF Modules stage.
 */

import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";

export const LOG_PREFIX = "[SSR-VF-MODULES]";

// Extensions to try when resolving framework files
export const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

// Get framework root - this works in both Deno source and compiled binaries
const RUNTIME_FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);

// Always use the runtime-detected framework root.
// In compiled binaries, embedded files are extracted to the runtime directory,
// NOT accessible at compile-time paths. The extraction structure mirrors the
// original directory layout, so dist/framework-src is at {extraction_root}/dist/framework-src.
export const FRAMEWORK_ROOT = RUNTIME_FRAMEWORK_ROOT;

// Directory containing embedded framework sources for compiled binaries.
// These are .src files created by scripts/prepare-framework-sources.ts.
// In compiled binaries, files are extracted to the runtime directory.
export const EMBEDDED_SRC_DIR = join(RUNTIME_FRAMEWORK_ROOT, "dist", "framework-src");

// Map of _vf_modules prefixes to framework directories
// We try embedded sources first (for compiled binaries), then regular src/
export const FRAMEWORK_LOOKUPS: Array<[prefix: string, frameworkDir: string]> = [
  // Embedded sources for compiled binaries (these are .src files)
  ["_veryfront/", EMBEDDED_SRC_DIR],
  // Regular sources for dev mode
  ["_veryfront/", join(FRAMEWORK_ROOT, "src")],
];

// Singleflight for framework module file writes to prevent race conditions
export const frameworkWriteFlight = new Singleflight<string>();

// Cache for already-transformed #veryfront/ dependencies to avoid cycles and redundant work
export const veryfrontTransformCache = new Map<string, string>();

// Cache for transformed framework files by absolute path to prevent cycles and redundant work
export const frameworkFileCache = new Map<string, string>();

// Track files currently being transformed to detect cycles
export const transformingFiles = new Set<string>();

// Maximum recursion depth for relative imports
export const MAX_RELATIVE_IMPORT_DEPTH = 10;

export interface TransformContext {
  reactVersion: string;
  projectDir: string;
  fs: ReturnType<typeof createFileSystem>;
}
