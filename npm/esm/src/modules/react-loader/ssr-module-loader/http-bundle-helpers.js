/**
 * HTTP Bundle Validation Helpers for SSR Module Loader
 *
 * Extracts and validates HTTP bundle paths from transformed code.
 * Used to proactively recover missing bundles before module import.
 *
 * @module module-system/react-loader/ssr-module-loader/http-bundle-helpers
 */
import { LRUCache } from "../../../utils/lru-wrapper.js";
/** Extract HTTP bundle paths from transformed code for proactive recovery */
export function extractHttpBundlePaths(code) {
    // Create regex per call to avoid shared lastIndex state across concurrent calls.
    const httpBundlePattern = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;
    const bundles = [];
    const seen = new Set();
    let match;
    while ((match = httpBundlePattern.exec(code)) !== null) {
        const path = match[1];
        const hash = match[2];
        if (!seen.has(hash)) {
            seen.add(hash);
            bundles.push({ path, hash });
        }
    }
    return bundles;
}
/**
 * Extract ALL file:// paths from cached code (local imports + HTTP bundles).
 * Used to validate that all paths in cached transforms exist locally before use.
 * This prevents "Module not found" errors when Redis returns transforms from
 * other pods with different temp directories.
 */
export function extractAllFilePaths(code) {
    // Create regex per call to avoid shared lastIndex state across concurrent calls.
    const allFilePathsPattern = /file:\/\/([^"'\s]+\.(?:mjs|js))/gi;
    const paths = [];
    const seen = new Set();
    let match;
    while ((match = allFilePathsPattern.exec(code)) !== null) {
        const path = match[1];
        if (!seen.has(path)) {
            seen.add(path);
            paths.push(path);
        }
    }
    return paths;
}
/**
 * Track modules whose HTTP bundles have been verified, keyed by tempPath:contentHash.
 * Bounded LRU to prevent unbounded memory growth in long-running pods.
 * Keying by contentHash ensures verification is re-done when content changes at the same path.
 */
export const verifiedHttpBundlePaths = new LRUCache({ maxEntries: 2000 });
