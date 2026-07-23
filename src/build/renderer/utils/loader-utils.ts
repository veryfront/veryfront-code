import type * as esbuild from "veryfront/extensions/bundler";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";

type FileType = "mdx" | "tsx" | "ts" | "jsx" | "js" | "css" | "json" | "unknown";

const EXTENSION_MAP: Record<string, FileType> = {
  mdx: "mdx",
  md: "mdx",
  tsx: "tsx",
  ts: "ts",
  mts: "ts",
  cts: "ts",
  jsx: "jsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  css: "css",
  json: "json",
};

const LOADER_MAP: Record<string, esbuild.Loader> = {
  mdx: "tsx",
  md: "tsx",
  tsx: "tsx",
  ts: "ts",
  mts: "ts",
  cts: "ts",
  jsx: "jsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  css: "css",
  json: "json",
};

export function getLoaderFromPath(path: string): esbuild.Loader {
  const extension = getExtensionName(path);
  return LOADER_MAP[extension] ?? "default";
}

export function getFileType(path: string): FileType {
  const extension = getExtensionName(path);
  return EXTENSION_MAP[extension] ?? "unknown";
}

export function getSlugFromPath(path: string): string {
  if (!path.trim() || path.includes("\0")) {
    throw new TypeError("Source path must not be blank or contain null bytes");
  }
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const rawSegments = normalized.split("/").filter(Boolean);
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("Source path must not contain traversal segments");
  }

  const segments = rawSegments.map((segment, index) => {
    const withoutExtension = index === rawSegments.length - 1
      ? segment.replace(/\.(mdx?|tsx?|jsx?|mjs|cjs|mts|cts)$/i, "")
      : segment;
    return withoutExtension
      .replace(/[^a-zA-Z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }).filter(Boolean);

  if (segments.length > 1 && segments.at(-1) === "index") segments.pop();
  return segments.join("/") || "index";
}
