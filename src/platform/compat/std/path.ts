/**
 * Portable @std/path shim for Node.js and Bun.
 *
 * In Deno: Uses @std/path
 * In Node.js/Bun: Re-exports from @veryfront/compat/path and node:path
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

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

const { posix } = isDeno ? await import("#std/path.ts") : await import("node:path");

export { posix };
export type { PosixPath };
