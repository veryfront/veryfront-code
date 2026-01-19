/**
 * Portable @std/path shim for Node.js and Bun.
 *
 * In Deno: Uses @std/path
 * In Node.js/Bun: Re-exports from @veryfront/compat/path and node:path
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

// Re-export everything from compat/path
export {
  basename,
  delimiter,
  dirname,
  extname,
  format,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
  SEPARATOR,
  toFileUrl,
} from "../path/index.ts";

// ============================================================================
// POSIX-specific exports
// ============================================================================

interface PosixPath {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  normalize(path: string): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  sep: string;
  delimiter: string;
}

export let posix: PosixPath;

if (isDeno) {
  // Deno: Use @std/path
  const stdPath = await import("@std/path");
  posix = stdPath.posix;
} else {
  // Node.js/Bun: Use node:path/posix
  const nodePath = await import("node:path");
  posix = nodePath.posix;
}
