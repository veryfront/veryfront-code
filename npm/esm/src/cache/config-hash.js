/**
 * Configuration hash for transform cache keys.
 *
 * Computes a hash of transform-affecting configuration to ensure
 * cache entries are invalidated when configuration changes.
 */
import { computeHash } from "../utils/index.js";
import { VERSION } from "../utils/version.js";
import { CSSTYPE_VERSION, DEFAULT_REACT_VERSION, TAILWIND_VERSION, } from "../transforms/import-rewriter/url-builder.js";
/**
 * Compute a hash of transform-affecting configuration.
 *
 * Changes to these values should invalidate cached transforms.
 */
export function computeConfigHash(config) {
    const normalized = {
        // Core transform settings
        transformVersion: VERSION,
        reactVersion: config.reactVersion ?? DEFAULT_REACT_VERSION,
        jsxImportSource: config.jsxImportSource ?? "react",
        // Feature flags
        studioEmbed: config.studioEmbed ?? false,
        dev: config.dev ?? false,
        // Package versions that affect output
        csstype: CSSTYPE_VERSION,
        tailwind: TAILWIND_VERSION,
    };
    return computeHash(JSON.stringify(normalized));
}
/**
 * Compute a quick config hash synchronously (less fields, faster).
 *
 * Use this when you need a config hash but can't afford async overhead.
 */
export function computeConfigHashSync(config) {
    // Simple string concatenation for sync hash
    const parts = [
        `v${VERSION}`,
        config.reactVersion ?? DEFAULT_REACT_VERSION,
        config.jsxImportSource ?? "react",
        config.studioEmbed ? "studio" : "",
        config.dev ? "dev" : "",
    ].filter(Boolean);
    return parts.join(":");
}
