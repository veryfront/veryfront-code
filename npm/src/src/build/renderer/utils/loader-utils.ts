import type * as esbuild from "esbuild";
import { getExtensionName } from "../../../utils/path-utils.js";

type FileType = "mdx" | "tsx" | "ts" | "jsx" | "js" | "css" | "json";

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

export function getLoaderFromPath(path: string): esbuild.Loader {
  return LOADER_MAP[getExtensionName(path)] ?? "default";
}

export function getFileType(path: string): FileType {
  return EXTENSION_MAP[getExtensionName(path)] ?? "js";
}

export function getSlugFromPath(path: string): string {
  return path
    .replace(/^\.\//, "")
    .replace(/\.(mdx|tsx|ts|jsx|js)$/, "")
    .replace(/\/index$/, "")
    .replace(/[^a-zA-Z0-9-/]/g, "-")
    .toLowerCase();
}
