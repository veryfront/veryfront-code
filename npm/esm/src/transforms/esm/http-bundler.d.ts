import type { Plugin } from "esbuild";
import { getReactUrls } from "./package-registry.js";
/** Check if code has HTTP imports */
export declare function hasHttpImports(code: string): boolean;
/** Strip Deno shim from esm.sh bundles (if present) */
export declare function stripDenoShim(code: string): string;
/** Re-export getReactUrls for backwards compatibility */
export { getReactUrls };
/** Alias for getReactUrls - used by esbuild bundling */
export declare function getReactAliases(): Record<string, string>;
/**
 * NOOP plugin for esbuild.
 */
export declare function createHTTPPlugin(): Plugin;
/**
 * Ensure esm.sh URLs have external=react,react-dom for SSR.
 * This makes them import React as bare specifiers, which the import map resolves.
 *
 * Uses two esm.sh features:
 * - `external=react,react-dom` - Don't bundle React/ReactDOM, let import map resolve them
 * - `deps=react@X,react-dom@X` - Pin dependency versions to prevent mismatches
 *
 * Logic for external handling:
 * 1. If no `external=` param → add `external=react,react-dom`
 * 2. If `external=X` exists but no `react` → append `,react,react-dom`
 * 3. If has `react` but no `react-dom` → append `,react-dom`
 * 4. If has both `react` AND `react-dom` → leave alone
 *
 * @param code - Source code to process
 * @param _cacheDir - Unused (kept for API compatibility)
 * @param hash - Hash for logging
 * @param reactVersion - React version for deps param (defaults to REACT_VERSION)
 */
export declare function bundleHttpImports(code: string, _cacheDir: string, hash: string, reactVersion?: string): string | Promise<string>;
//# sourceMappingURL=http-bundler.d.ts.map