import type { Loader } from "esbuild";
import { shortHash } from "#veryfront/utils/hash-utils.ts";

/**
 * Compute a short 8-character content hash for cache keys.
 * Use this for transform cache keys where a compact hash is preferred.
 */
export function computeShortContentHash(content: string): Promise<string> {
  return shortHash(content);
}

/** @deprecated Use computeShortContentHash instead to avoid naming collision with full hash version */
export const computeContentHash = computeShortContentHash;

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

export function getLoaderFromPath(filePath: string): Loader {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return EXTENSION_LOADERS[ext] ?? "tsx";
}

export function needsTransform(filePath: string): boolean {
  return /\.(tsx?|jsx?|mdx?|md)$/.test(filePath);
}
