import { shortHash } from "../../utils/hash-utils.js";
/**
 * Compute a short 8-character content hash for cache keys.
 * Use this for transform cache keys where a compact hash is preferred.
 */
export function computeShortContentHash(content) {
    return shortHash(content);
}
/** @deprecated Use computeShortContentHash instead to avoid naming collision with full hash version */
export const computeContentHash = computeShortContentHash;
const EXTENSION_LOADERS = {
    ".tsx": "tsx",
    ".ts": "ts",
    ".jsx": "jsx",
    ".js": "js",
    ".mdx": "jsx",
    ".md": "jsx",
    ".css": "css",
    ".json": "json",
};
export function getLoaderFromPath(filePath) {
    const extIndex = filePath.lastIndexOf(".");
    const ext = extIndex === -1 ? "" : filePath.slice(extIndex);
    return EXTENSION_LOADERS[ext] ?? "tsx";
}
export function needsTransform(filePath) {
    return /\.(tsx?|jsx?|mdx?|md)$/.test(filePath);
}
