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
 * Ensure esm.sh URLs have ?external=react for SSR.
 * This makes them import React as a bare specifier, which deno.json resolves.
 *
 * Uses two esm.sh features:
 * - `external=react` - Don't bundle React, let import map resolve it
 * - `deps=react@X,react-dom@X` - Pin dependency versions to prevent mismatches
 */
export declare function bundleHttpImports(code: string, _cacheDir: string, hash: string): string | Promise<string>;
//# sourceMappingURL=http-bundler.d.ts.map