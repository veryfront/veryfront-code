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
export function isValidReactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Validate and normalize React version.
 * Returns the version if valid, or DEFAULT_REACT_VERSION if invalid.
 * Logs a warning if the version is invalid.
 */
export function normalizeReactVersion(version: string | undefined): string {
  if (!version) return DEFAULT_REACT_VERSION;
  if (isValidReactVersion(version)) return version;
  console.warn(
    `[VERYFRONT] Invalid React version format "${version}" (expected X.Y.Z). Using default: ${DEFAULT_REACT_VERSION}`,
  );
  return DEFAULT_REACT_VERSION;
}

/**
 * @deprecated Global React version is no longer supported.
 * Use config.react.version passed through TransformOptions instead.
 * This function now always returns DEFAULT_REACT_VERSION.
 */
export function getReactVersion(): string {
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
 */
export const TRANSFORM_CACHE_VERSION = 12;

function esmSh(pkg: string, version: string, path = "", query = "target=es2022"): string {
  return `https://esm.sh/${pkg}@${version}${path}?${query}`;
}

/**
 * Generate esm.sh URL for browser.
 * Uses ?external= so browser import map provides React (ensures single instance).
 * Uses ?target=es2022 for consistent builds.
 */
export function getEsmShUrl(pkg: string, version: string, external?: readonly string[]): string {
  const params = ["target=es2022"];
  if (external?.length) params.push(`external=${external.join(",")}`);
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
export function getReactUrls(version?: string): Record<string, string> {
  const v = version ?? getReactVersion();
  return {
    react: esmSh("react", v),
    "react-dom": esmSh("react-dom", v, "", "external=react&target=es2022"),
    "react-dom/client": esmSh("react-dom", v, "/client", "external=react&target=es2022"),
    "react-dom/server": esmSh("react-dom", v, "/server", "external=react&target=es2022"),
    "react/jsx-runtime": esmSh("react", v, "/jsx-runtime", "external=react&target=es2022"),
    "react/jsx-dev-runtime": esmSh("react", v, "/jsx-dev-runtime", "external=react&target=es2022"),
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
export function getReactImportMap(version?: string): Record<string, string> {
  const v = version ?? getReactVersion();
  return {
    ...getReactUrls(v),
    // Prefix match for any react/* subpath imports
    "react/": esmSh("react", v, "/", "external=react&target=es2022"),
  };
}

/**
 * Get React npm specifiers for Deno SSR.
 * Uses npm: protocol which Deno handles natively with automatic deduplication.
 * See: https://deno.com/blog/not-using-npm-specifiers-doing-it-wrong
 *
 * Benefits over esm.sh:
 * - Automatic semantic version deduplication (like Node's node_modules)
 * - No manual external= flags or shared-*.ts wrapper files needed
 * - Native support in Deno 2+
 *
 * @param version - React version to use (defaults to REACT_VERSION)
 */
export function getDenoNpmReactMap(version?: string): Record<string, string> {
  const v = version ?? getReactVersion();
  return {
    "react": `npm:react@${v}`,
    "react-dom": `npm:react-dom@${v}`,
    "react-dom/client": `npm:react-dom@${v}/client`,
    "react-dom/server": `npm:react-dom@${v}/server`,
    "react/jsx-runtime": `npm:react@${v}/jsx-runtime`,
    "react/jsx-dev-runtime": `npm:react@${v}/jsx-dev-runtime`,
  };
}
