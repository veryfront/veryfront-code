/**
 * File loader utilities
 */

import type * as esbuild from "esbuild";

type FileType = "mdx" | "tsx" | "ts" | "jsx" | "js" | "css" | "json";

/** Extension to file type mapping */
const EXTENSION_MAP: Record<string, FileType> = {
  mdx: "mdx",
  tsx: "tsx",
  ts: "ts",
  jsx: "jsx",
  js: "js",
  mjs: "js",
  css: "css",
  json: "json",
};

/** Get file extension from path */
function getExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/** Extension to esbuild loader mapping */
const LOADER_MAP: Record<string, esbuild.Loader> = {
  mdx: "tsx", // MDX compiles to TSX
  tsx: "tsx",
  ts: "ts",
  jsx: "jsx",
  js: "js",
  mjs: "js",
  css: "css",
  json: "json",
};

/**
 * Get esbuild loader based on file extension
 */
export function getLoaderFromPath(path: string): esbuild.Loader {
  return LOADER_MAP[getExtension(path)] ?? "default";
}

/**
 * Get file type from path
 */
export function getFileType(path: string): FileType {
  return EXTENSION_MAP[getExtension(path)] ?? "js";
}

/**
 * Get slug from file path
 */
export function getSlugFromPath(path: string): string {
  return path
    .replace(/^\.\//, "")
    .replace(/\.(mdx|tsx|ts|jsx|js)$/, "")
    .replace(/\/index$/, "")
    .replace(/[^a-zA-Z0-9-/]/g, "-")
    .toLowerCase();
}
