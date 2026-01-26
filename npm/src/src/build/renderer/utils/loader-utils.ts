import type * as esbuild from "esbuild";

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

function getExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function getLoaderFromPath(path: string): esbuild.Loader {
  return LOADER_MAP[getExtension(path)] ?? "default";
}

export function getFileType(path: string): FileType {
  return EXTENSION_MAP[getExtension(path)] ?? "js";
}

export function getSlugFromPath(path: string): string {
  return path
    .replace(/^\.\//, "")
    .replace(/\.(mdx|tsx|ts|jsx|js)$/, "")
    .replace(/\/index$/, "")
    .replace(/[^a-zA-Z0-9-/]/g, "-")
    .toLowerCase();
}
