import type { Loader } from "esbuild";
import { shortHash } from "@veryfront/utils/hash-utils.ts";

export function computeContentHash(content: string): Promise<string> {
  return shortHash(content);
}

export function getLoaderFromPath(filePath: string): Loader {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "ts";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".js")) return "js";
  if (filePath.endsWith(".mdx")) return "jsx"; // MDX pre-compiled to JSX
  if (filePath.endsWith(".css")) return "css";
  if (filePath.endsWith(".json")) return "json";
  return "tsx"; // Default
}

export function needsTransform(filePath: string): boolean {
  return /\.(tsx?|jsx?|mdx)$/.test(filePath);
}
