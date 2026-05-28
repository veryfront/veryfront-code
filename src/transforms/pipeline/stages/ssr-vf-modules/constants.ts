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

// Map of _vf_modules prefixes to framework directories.
// Prefer regular src/ when present so source checkouts never serve stale
// dist/framework-src copies; compiled binaries fall back to embedded .src files.
export const FRAMEWORK_LOOKUPS: Array<[prefix: string, frameworkDir: string]> = [
  // Regular sources for dev mode
  ["_veryfront/", join(FRAMEWORK_ROOT, "src")],
  // Embedded sources for compiled binaries (these are .src files)
  ["_veryfront/", EMBEDDED_SRC_DIR],
];

// Singleflight for framework module file writes to prevent race conditions
export const frameworkWriteFlight = new Singleflight<string>();

// Singleflight for top-level framework source transforms so concurrent user
// modules importing the same veryfront/* module do not receive cycle placeholders.
export const frameworkTransformFlight = new Singleflight<string>();

// Cache for already-transformed #veryfront/ dependencies to avoid cycles and redundant work
export const veryfrontTransformCache = new Map<string, string>();

// Cache for transformed framework files by absolute path to prevent cycles and redundant work
export const frameworkFileCache = new Map<string, string>();

// Track files currently being transformed to detect cycles
export const transformingFiles = new Set<string>();

// Maximum recursion depth for chained relative imports within framework
// source. veryfront's own framework tree has relative-import chains deeper
// than 10 (e.g. errors/utils/schemas internals reach ~11), and crossing a
// `#veryfront/` boundary resets the counter, so this only bounds consecutive
// `./`/`../` nesting. Cycles are caught separately by `transformingFiles`;
// this is purely a stack-safety bound, so it is set generously above the
// framework's real depth. Exceeding it falls back to a degraded transform.
export const MAX_RELATIVE_IMPORT_DEPTH = 64;

export interface TransformContext {
  reactVersion: string;
  projectDir: string;
  fs: ReturnType<typeof createFileSystem>;
}
