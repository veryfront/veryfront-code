
import type * as esbuild from "esbuild";

export function getLoaderFromPath(path: string): esbuild.Loader {
  const ext = path.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
      return "js";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    case "css":
      return "css";
    case "mdx":
      return "tsx";
    default:
      return "default";
  }
}

export function getFileType(path: string): "mdx" | "tsx" | "ts" | "jsx" | "js" | "css" | "json" {
  const ext = path.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "mdx":
      return "mdx";
    case "tsx":
      return "tsx";
    case "ts":
      return "ts";
    case "jsx":
      return "jsx";
    case "js":
    case "mjs":
      return "js";
    case "css":
      return "css";
    case "json":
      return "json";
    default:
      return "js";
  }
}

export function getSlugFromPath(path: string): string {
  return path
    .replace(/^\.\
    .replace(/\.(mdx|tsx|ts|jsx|js)$/, "")
    .replace(/\/index$/, "")
    .replace(/[^a-zA-Z0-9-/]/g, "-")
    .toLowerCase();
}
