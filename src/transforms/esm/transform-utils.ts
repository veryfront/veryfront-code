import type { Loader } from "veryfront/extensions/bundler";
import { shortHash } from "#veryfront/utils/hash-utils.ts";

/**
 * Compute a short 8-character content hash for cache keys.
 * Use this for transform cache keys where a compact hash is preferred.
 */
export function computeShortContentHash(content: string): Promise<string> {
  return shortHash(content);
}

/**
 * esbuild feature overrides shared by every source transform.
 *
 * Import attributes post-date the `es20xx` targets we lower to, so esbuild
 * would silently *drop* `with { type: "json" }` rather than fail. Every runtime
 * that consumes this output requires the attribute to load a JSON module, so
 * dropping it turns a working import into a load-time error:
 * `Attempted to load JSON module without specifying "type": "json"`.
 */
export const ESBUILD_SUPPORTED_FEATURES = { "import-attributes": true } as const;

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
