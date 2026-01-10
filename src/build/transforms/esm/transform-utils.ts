import type { Loader } from "esbuild";
import { shortHash } from "@veryfront/utils/hash-utils.ts";

export function computeContentHash(content: string): Promise<string> {
  return shortHash(content);
}

const EXTENSION_LOADERS: Record<string, Loader> = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".jsx": "jsx",
  ".js": "js",
  ".mdx": "jsx", // MDX pre-compiled to JSX
  ".css": "css",
  ".json": "json",
};

export function getLoaderFromPath(filePath: string): Loader {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return EXTENSION_LOADERS[ext] ?? "tsx";
}

export function needsTransform(filePath: string): boolean {
  return /\.(tsx?|jsx?|mdx)$/.test(filePath);
}
