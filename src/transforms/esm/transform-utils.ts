import type { Loader } from "veryfront/extensions/bundler";
import { shortHash } from "#veryfront/utils/hash-utils.ts";

/**
 * Compute a short 8-character content hash for cache keys.
 * Use this for transform cache keys where a compact hash is preferred.
 */
export function computeShortContentHash(content: string): Promise<string> {
  return shortHash(content);
}

const EXTENSION_LOADERS: Record<string, Loader> = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".jsx": "jsx",
  ".js": "js",
  ".mdx": "jsx",
  ".md": "jsx",
  ".css": "css",
  ".json": "json",
};

/** Select the esbuild loader associated with a source-file extension. */
export function getLoaderFromPath(filePath: string): Loader {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return EXTENSION_LOADERS[ext] ?? "tsx";
}

/** Return whether a source-file extension requires JavaScript compilation. */
export function needsTransform(filePath: string): boolean {
  return /\.(tsx?|jsx?|mdx?|md)$/.test(filePath);
}
