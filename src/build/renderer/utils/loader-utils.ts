import type * as esbuild from "veryfront/extensions/bundler";
import { isAbsolute } from "#veryfront/compat/path/index.ts";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";

type FileType = "mdx" | "tsx" | "ts" | "jsx" | "js" | "css" | "json" | "unknown";

const MAX_SLUG_SOURCE_CHARACTERS = 4_096;

const EXTENSION_MAP: Record<string, FileType> = {
  mdx: "mdx",
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

/**
 * Derive a stable URL slug from a project-relative source path.
 *
 * Filesystem roots and parent traversal are rejected so host paths cannot
 * accidentally become public route metadata.
 */
export function getSlugFromPath(path: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_SLUG_SOURCE_CHARACTERS ||
    hasControlCharacters(path) ||
    isAbsolute(path)
  ) {
    throw new TypeError("Slug source must be a safe project-relative path");
  }

  const sourceSegments = path.replaceAll("\\", "/").split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (sourceSegments.length === 0 || sourceSegments.includes("..")) {
    throw new TypeError("Slug source must be a safe project-relative path");
  }

  const lastIndex = sourceSegments.length - 1;
  sourceSegments[lastIndex] = sourceSegments[lastIndex]!.replace(
    /\.(?:mdx|[cm]?[jt]sx?)$/i,
    "",
  );
  if (
    sourceSegments.length > 1 &&
    sourceSegments[lastIndex]!.toLowerCase() === "index"
  ) {
    sourceSegments.pop();
  }

  return sourceSegments.map((segment) => {
    const normalized = segment.normalize("NFKC").toLowerCase()
      .replace(/[^\p{Letter}\p{Number}-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (normalized.length === 0) {
      throw new TypeError(`Slug path segment ${JSON.stringify(segment)} has no URL-safe content`);
    }
    return normalized;
  }).join("/");
}
