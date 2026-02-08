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
