/**
 * Filesystem operations and path utilities.
 *
 * @module fs
 *
 * @example File operations
 * ```ts
 * import { readTextFile, writeTextFile, mkdir, exists } from "veryfront/fs";
 *
 * const content = await readTextFile("./data/config.json");
 * await writeTextFile("./output/result.json", JSON.stringify(data));
 * await mkdir("./output", { recursive: true });
 * ```
 *
 * @example Path utilities
 * ```ts
 * import { join, resolve, dirname, basename, extname } from "veryfront/fs";
 *
 * const filePath = join("src", "pages", "index.tsx");
 * const dir = dirname(filePath); // "src/pages"
 * ```
 */

// veryfront/fs — Filesystem operations + path utilities
//
// Slim public surface for file I/O, path manipulation, and
// project context (cwd). Re-exports from the platform compat layer.

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export { createFileSystem } from "#veryfront/platform/compat/fs.ts";
export { readTextFile } from "#veryfront/platform/compat/fs.ts";
export { writeTextFile } from "#veryfront/platform/compat/fs.ts";
export { mkdir } from "#veryfront/platform/compat/fs.ts";
export { exists } from "#veryfront/platform/compat/fs.ts";
export { remove } from "#veryfront/platform/compat/fs.ts";
export { readDir } from "#veryfront/platform/compat/fs.ts";
export type { FileSystem } from "#veryfront/platform/compat/fs.ts";

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

export {
  basename,
  dirname,
  extname,
  join,
} from "#veryfront/platform/compat/path/basic-operations.ts";
export { resolve } from "#veryfront/platform/compat/path/resolution.ts";

// ---------------------------------------------------------------------------
// Project context
// ---------------------------------------------------------------------------

export { cwd } from "#veryfront/platform/compat/process.ts";
