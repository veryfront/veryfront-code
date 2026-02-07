// veryfront/fs — Filesystem operations + path utilities
//
// Slim public surface for file I/O, path manipulation, and
// project context (cwd). Re-exports from the platform compat layer.

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export { createFileSystem } from "../platform/compat/fs.ts";
export { readTextFile } from "../platform/compat/fs.ts";
export { writeTextFile } from "../platform/compat/fs.ts";
export { mkdir } from "../platform/compat/fs.ts";
export { exists } from "../platform/compat/fs.ts";
export { remove } from "../platform/compat/fs.ts";
export { readDir } from "../platform/compat/fs.ts";
export type { FileSystem } from "../platform/compat/fs.ts";

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

export { basename, dirname, extname, join } from "../platform/compat/path/basic-operations.ts";
export { resolve } from "../platform/compat/path/resolution.ts";

// ---------------------------------------------------------------------------
// Project context
// ---------------------------------------------------------------------------

export { cwd } from "../platform/compat/process.ts";
