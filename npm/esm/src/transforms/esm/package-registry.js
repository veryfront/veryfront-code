/**
 * Central package version and URL registry.
 *
 * Single source of truth for all package versions used in both SSR and browser transforms.
 * SSR resolves to esm.sh URLs (then cached to file://), browser uses esm.sh URLs.
 */
/** Default React version - used when not specified in project config */
export const DEFAULT_REACT_VERSION = "19.1.1";
export const TAILWIND_VERSION = "4.1.8";
/**
 * Validate React version format (semver: X.Y.Z).
 * Returns true if valid, false otherwise.
 */
export function isValidReactVersion(version) {
    return /^\d+\.\d+\.\d+$/.test(version);
}
/**
 * Validate and normalize React version.
 * Returns the version if valid, or DEFAULT_REACT_VERSION if invalid.
 * Logs a warning if the version is invalid.
 */
export function normalizeReactVersion(version) {
    if (!version)
        return DEFAULT_REACT_VERSION;
    if (isValidReactVersion(version))
        return version;
    console.warn(`[VERYFRONT] Invalid React version format "${version}" (expected X.Y.Z). Using default: ${DEFAULT_REACT_VERSION}`);
    return DEFAULT_REACT_VERSION;
}
/**
 * @deprecated Global React version is no longer supported.
 * Use config.react.version passed through TransformOptions instead.
 * This function now always returns DEFAULT_REACT_VERSION.
 */
export function getReactVersion() {
    return DEFAULT_REACT_VERSION;
}
/** @deprecated Use DEFAULT_REACT_VERSION or getReactVersion() */
export const REACT_VERSION = DEFAULT_REACT_VERSION;
/**
 * Transform cache version - bump when transform logic changes.
 * This invalidates all cached modules (local + Redis) to prevent stale transform issues.
 * See: https://github.com/veryfront/veryfront-renderer/issues/79
 *
 * v2: Skip ssr-http-cache on Deno for cross-pod compatibility
 * v3: Use HTTP imports in shared React modules on Deno
 * v4: Enable ssr-http-cache for Deno; resolve React to shared-*.ts files
 * v5: Use npm: specifiers for Deno SSR (auto-dedup, no shared-*.ts needed)
 * v6: Update all shared-*.ts files to use npm: specifiers
 * v7: Keep npm: specifiers for Deno in http-cache (don't convert to esm.sh)
 * v8: Remove shared-*.ts files; use npm: specifiers directly in deno.json
 * v9: Align ssr-import-rewriter to use npm: specifiers for Deno SSR
 * v10: Fix import regex to match minified code (from"..." without whitespace)
 * v11: Add HTTP bundle hash→URL mapping for cross-pod recovery
 * v12: Store HTTP bundle code by hash for direct recovery (code:{hash})
 * v13: Fix npm: specifiers for Node.js (convert to esm.sh or local React)
 * v14: Fix SSR pipeline to use local React paths on Node.js (not esm.sh URLs)
 * v15: Keep React as bare specifiers on Node.js for CJS/ESM interop
 * v16: Invalidate Deno-created transforms with https:// React URLs
 */
export const TRANSFORM_CACHE_VERSION = 16;
/** csstype version - must match deno.json for type consistency */
export const CSSTYPE_VERSION = "3.2.3";
/**
 * Build esm.sh URL with deps=csstype for React packages (ensures type consistency).
 * CRITICAL: This is the single source of truth for React URLs. All other files
 * (html/utils.ts, import-rewriter.ts, etc.) must use this or getReactImportMap().
 */
export function esmShReact(pkg, version, path = "", external = false) {
    const params = external
        ? [`external=react`, `target=es2022`, `deps=csstype@${CSSTYPE_VERSION}`]
        : [`target=es2022`, `deps=csstype@${CSSTYPE_VERSION}`];
    return `https://esm.sh/${pkg}@${version}${path}?${params.join("&")}`;
}
/**
 * Generate esm.sh URL for browser.
 * Uses ?external= so browser import map provides React (ensures single instance).
 * Uses ?target=es2022 for consistent builds.
 */
export function getEsmShUrl(pkg, version, external) {
    const params = ["target=es2022"];
    if (external?.length)
        params.push(`external=${external.join(",")}`);
    return `https://esm.sh/${pkg}@${version}?${params.join("&")}`;
}
/**
 * Get React esm.sh URLs with consistent versioning.
 * Used by both SSR and browser for full-stack consistency.
 * Uses ?target=es2022 to ensure identical builds (esm.sh auto-detects target otherwise).
 *
 * All React sub-packages must use external=react to share the same React instance.
 * This ensures jsx-runtime, react-dom, and third-party packages all use one React.
 *
 * @param version - React version to use (defaults to configured or DEFAULT_REACT_VERSION)
 */
export function getReactUrls(version) {
    const v = version ?? getReactVersion();
    return {
        react: esmShReact("react", v),
        "react-dom": esmShReact("react-dom", v, "", true),
        "react-dom/client": esmShReact("react-dom", v, "/client", true),
        "react-dom/server": esmShReact("react-dom", v, "/server", true),
        "react/jsx-runtime": esmShReact("react", v, "/jsx-runtime", true),
        "react/jsx-dev-runtime": esmShReact("react", v, "/jsx-dev-runtime", true),
    };
}
/**
 * Get complete React import map for esm.sh.
 * This is used by BOTH SSR and browser to ensure identical React instances,
 * preventing hydration mismatches.
 *
 * Works in Deno, Node, and Bun since esm.sh URLs are standard HTTPS imports.
 * Uses ?target=es2022 to ensure identical builds across all runtimes.
 *
 * @param version - React version to use (defaults to configured or DEFAULT_REACT_VERSION)
 */
export function getReactImportMap(version) {
    const v = version ?? getReactVersion();
    return {
        ...getReactUrls(v),
        // Prefix match for any react/* subpath imports
        "react/": esmShReact("react", v, "/", true),
    };
}
/**
 * Get React esm.sh URLs for Deno SSR.
 * Uses esm.sh for both SSR and browser to ensure identical React instances.
 * All sub-packages use external=react to share the same React instance.
 *
 * @param version - React version to use (defaults to REACT_VERSION)
 */
export function getDenoNpmReactMap(version) {
    const v = version ?? getReactVersion();
    return {
        "react": esmShReact("react", v),
        "react-dom": esmShReact("react-dom", v, "", true),
        "react-dom/client": esmShReact("react-dom", v, "/client", true),
        "react-dom/server": esmShReact("react-dom", v, "/server", true),
        "react/jsx-runtime": esmShReact("react", v, "/jsx-runtime", true),
        "react/jsx-dev-runtime": esmShReact("react", v, "/jsx-dev-runtime", true),
    };
}
