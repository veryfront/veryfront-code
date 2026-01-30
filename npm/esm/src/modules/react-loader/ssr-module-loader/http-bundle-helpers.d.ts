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
export declare function extractHttpBundlePaths(code: string): Array<{
    path: string;
    hash: string;
}>;
/**
 * Extract ALL file:// paths from cached code (local imports + HTTP bundles).
 * Used to validate that all paths in cached transforms exist locally before use.
 * This prevents "Module not found" errors when Redis returns transforms from
 * other pods with different temp directories.
 */
export declare function extractAllFilePaths(code: string): string[];
/**
 * Track modules whose HTTP bundles have been verified, keyed by tempPath:contentHash.
 * Bounded LRU to prevent unbounded memory growth in long-running pods.
 * Keying by contentHash ensures verification is re-done when content changes at the same path.
 */
export declare const verifiedHttpBundlePaths: LRUCache<string, true>;
//# sourceMappingURL=http-bundle-helpers.d.ts.map