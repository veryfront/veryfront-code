/**
 * Canonical URL builders for import rewriting.
 *
 * Single source of truth for all URL generation.
 * Ensures consistent URLs across SSR and browser for hydration parity.
 */
/** Default React version - used when not specified */
export declare const DEFAULT_REACT_VERSION = "19.1.1";
/** Tailwind CSS version */
export declare const TAILWIND_VERSION = "4.1.8";
/** csstype version - must match deno.json for type consistency */
export declare const CSSTYPE_VERSION = "3.2.3";
/**
 * Build esm.sh URL with proper configuration.
 *
 * @param pkg - Package name (e.g., "react", "lodash")
 * @param version - Package version (optional)
 * @param subpath - Subpath (e.g., "/jsx-runtime")
 * @param options - URL options
 */
export declare function buildEsmShUrl(pkg: string, version?: string, subpath?: string, options?: {
    external?: string[];
    target?: string;
    deps?: Record<string, string>;
}): string;
/**
 * Build React esm.sh URL.
 * Uses deps=csstype for type consistency.
 */
export declare function buildReactUrl(pkg: "react" | "react-dom", version: string, subpath?: string, external?: boolean): string;
/**
 * Get complete React import map for a specific version.
 */
export declare function getReactImportMap(version: string): Record<string, string>;
/**
 * Build module server URL for a path.
 */
export declare function buildModuleServerUrl(baseUrl: string, path: string): string;
/**
 * Build cross-project import URL.
 */
export declare function buildCrossProjectUrl(projectSlug: string, version: string | null, path: string): string;
/**
 * Build veryfront framework module URL.
 */
export declare function buildVeryfrontModuleUrl(path: string): string;
/**
 * Normalize file extension for JavaScript output.
 */
export declare function normalizeExtension(path: string, options?: {
    removeExtension?: boolean;
}): string;
/**
 * Check if a URL is an esm.sh URL.
 */
export declare function isEsmShUrl(url: string): boolean;
/**
 * Add deps query param to esm.sh URL if not already present.
 */
export declare function addEsmShDeps(url: string, reactVersion: string): string;
//# sourceMappingURL=url-builder.d.ts.map