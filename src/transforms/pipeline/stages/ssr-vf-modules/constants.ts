/**
 * Shared constants, types, and caches for the SSR VF Modules stage.
 */

import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { isCompiledBinary } from "#veryfront/utils/platform.ts";
import { fnv1aHash, hashCodeHex } from "#veryfront/utils/hash-utils.ts";

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

/**
 * Build the framework source lookup order for the active runtime.
 *
 * Deno compile exposes imported `src/` files through its virtual filesystem,
 * but those copies may already contain compile-time import-map rewrites. Using
 * them as transform input can pin framework components to the build's React
 * version instead of the project's version. Compiled binaries therefore use
 * the pristine `.src` assets first. Source checkouts keep live `src/` files
 * first so local edits cannot be shadowed by stale generated assets.
 */
export function getFrameworkLookups(
  compiled = isCompiledBinary(),
): Array<[prefix: string, frameworkDir: string]> {
  const source: [string, string] = ["_veryfront/", join(FRAMEWORK_ROOT, "src")];
  const embedded: [string, string] = ["_veryfront/", EMBEDDED_SRC_DIR];
  return compiled ? [embedded, source] : [source, embedded];
}

export const FRAMEWORK_LOOKUPS = getFrameworkLookups();

// Singleflight for framework module file writes to prevent race conditions
export const frameworkWriteFlight = new Singleflight<string>();

// Singleflight for top-level framework source transforms so concurrent user
// modules importing the same veryfront/* module do not receive cycle placeholders.
export const frameworkTransformFlight = new Singleflight<string>();

// Singleflight for root framework-file transforms. Recursive transforms use
// per-call ancestry instead so a real dependency cycle returns immediately
// rather than awaiting its own in-flight promise.
export const frameworkFileTransformFlight = new Singleflight<string>();

/**
 * Scope every in-memory framework transform entry to the project and React
 * runtime that produced it. Framework output contains concrete React bundle
 * URLs and is rewritten through the project's import map. Sharing an entry
 * across either boundary can link a renderer to the wrong dependency graph.
 */
export function buildFrameworkTransformCacheKey(
  identifier: string,
  reactVersion: string,
  projectDir: string,
  sourceContent: string,
): string {
  const contentFingerprint = `${sourceContent.length}:${hashCodeHex(sourceContent)}:${
    fnv1aHash(sourceContent)
  }`;
  return JSON.stringify([projectDir, reactVersion, identifier, contentFingerprint]);
}

// Maximum entries for the per-process framework transform caches.
// The framework source tree is large but finite; 500 entries comfortably covers
// a full build while bounding memory in long-running servers.  Evicted entries
// are simply recomputed on the next request.
const FRAMEWORK_CACHE_MAX_ENTRIES = 500;

// Cache for already-transformed #veryfront/ dependencies to avoid cycles and redundant work.
// Bounded with LRUCache to prevent unbounded memory growth in long-running servers.
export const veryfrontTransformCache = new LRUCache<string, string>({
  maxEntries: FRAMEWORK_CACHE_MAX_ENTRIES,
});

// Cache for transformed framework files by absolute path to prevent cycles and redundant work.
// Bounded with LRUCache to prevent unbounded memory growth in long-running servers.
export const frameworkFileCache = new LRUCache<string, string>({
  maxEntries: FRAMEWORK_CACHE_MAX_ENTRIES,
});

// Track active transforms for diagnostics and cleanup assertions.
export const transformingFiles = new Set<string>();

// Maximum recursion depth for chained relative imports within framework
// source. veryfront's own framework tree has relative-import chains deeper
// than 10 (e.g. errors/utils/schemas internals reach ~11), and crossing a
// `#veryfront/` boundary resets the counter, so this only bounds consecutive
// `./`/`../` nesting. Cycles are detected by traversal-local ancestry. This is
// purely a stack-safety bound, so it is set generously above the framework's
// real depth. Exceeding this limit falls back to a degraded transform.
export const MAX_RELATIVE_IMPORT_DEPTH = 64;

export interface TransformContext {
  reactVersion: string;
  projectDir: string;
  fs: ReturnType<typeof createFileSystem>;
  /** Transform keys already visited by the current recursive traversal. */
  transformAncestry?: ReadonlySet<string>;
}
