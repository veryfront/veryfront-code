/**
 * Central package version and URL registry.
 *
 * Re-exports from the unified import-rewriter module.
 * This file is kept for backward compatibility with existing imports.
 */
import { CSSTYPE_VERSION, DEFAULT_REACT_VERSION, TAILWIND_VERSION } from "../import-rewriter/url-builder.js";
export { CSSTYPE_VERSION, DEFAULT_REACT_VERSION, TAILWIND_VERSION };
/** @deprecated Use DEFAULT_REACT_VERSION instead */
export declare const REACT_VERSION = "19.1.1";
/**
 * Validate React version format (semver: X.Y.Z).
 */
export declare function isValidReactVersion(version: string): boolean;
/**
 * Validate and normalize React version.
 */
export declare function normalizeReactVersion(version: string | undefined): string;
/**
 * @deprecated Use DEFAULT_REACT_VERSION directly
 */
export declare function getReactVersion(): string;
/**
 * Transform cache version - now uses the application VERSION for consistent
 * cache invalidation on deployments.
 *
 * @deprecated Use VERSION from #veryfront/utils/version.ts directly
 */
export declare const TRANSFORM_CACHE_VERSION: string;
/**
 * Build esm.sh URL with deps=csstype for React packages.
 */
export declare function esmShReact(pkg: string, version: string, path?: string, external?: boolean): string;
/**
 * Generate esm.sh URL for browser.
 */
export declare function getEsmShUrl(pkg: string, version: string, external?: readonly string[]): string;
/**
 * Get React esm.sh URLs with consistent versioning.
 */
export declare function getReactUrls(version?: string): Record<string, string>;
/**
 * Get complete React import map for esm.sh.
 */
export declare function getReactImportMap(version?: string): Record<string, string>;
/**
 * Get React esm.sh URLs for Deno SSR.
 */
export declare function getDenoNpmReactMap(version?: string): Record<string, string>;
//# sourceMappingURL=package-registry.d.ts.map