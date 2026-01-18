/**
 * Cross-platform shim for Deno std/path module
 * Provides fromFileUrl and toFileUrl that exist in Deno but not Node.js
 */

import * as nodeUrl from "node:url";
import * as nodePath from "node:path";

/**
 * Convert a file URL to a path (Deno std/path compatibility)
 */
export function fromFileUrl(url: string | URL): string {
  return nodeUrl.fileURLToPath(url);
}

/**
 * Convert a path to a file URL (Deno std/path compatibility)
 */
export function toFileUrl(path: string): URL {
  return nodeUrl.pathToFileURL(path);
}

// Re-export all node:path functions
export const basename = nodePath.basename;
export const dirname = nodePath.dirname;
export const extname = nodePath.extname;
export const join = nodePath.join;
export const resolve = nodePath.resolve;
export const relative = nodePath.relative;
export const isAbsolute = nodePath.isAbsolute;
export const normalize = nodePath.normalize;
export const parse = nodePath.parse;
export const format = nodePath.format;
export const sep = nodePath.sep;
export const delimiter = nodePath.delimiter;

// Deno std/path compatibility - SEPARATOR is an alias for sep
export const SEPARATOR = nodePath.sep;
export const SEPARATOR_PATTERN = nodePath.sep === "/" ? /\/+/ : /[\\/]+/;
