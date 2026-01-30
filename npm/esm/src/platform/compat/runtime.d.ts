/** True if running in Bun runtime (check first since Bun has process.versions.node) */
export declare const isBun: boolean;
/** True if running in Node.js runtime (has process.versions.node, not Bun, not shimmed Deno) */
export declare const isNode: boolean;
/** True if running in real Deno runtime (not dnt shim) */
export declare const isDeno: boolean;
/** True if running in Cloudflare Workers runtime */
export declare const isCloudflare: boolean;
/**
 * Detect if running in Node.js (vs Deno) at call time.
 * Use this function instead of the constant when runtime detection needs to happen
 * at call time (e.g., when bundled with esbuild's __esm lazy initialization pattern).
 */
export declare function isNodeRuntime(): boolean;
/**
 * Detect if code is executing in a server environment (SSR).
 *
 * This function provides consistent SSR detection that works correctly even when
 * SSR globals stub the window/document objects. It should be used instead of
 * `typeof window === "undefined"` checks to avoid hydration mismatches.
 *
 * Priority:
 * 1. Check __VERYFRONT_SSR__ flag (set by ssr-globals/index.ts) - most reliable
 * 2. Check if window is undefined (fallback for non-veryfront environments)
 *
 * @returns true if executing on server, false if in browser
 * @see plans/architecture-audit/006.1-ssr-detection-inconsistencies.md
 */
export declare function isServerEnvironment(): boolean;
/**
 * Detect if code is executing in a browser environment.
 * Inverse of isServerEnvironment() - use this instead of `typeof window !== "undefined"`.
 *
 * @returns true if executing in browser, false if on server
 */
export declare function isBrowserEnvironment(): boolean;
//# sourceMappingURL=runtime.d.ts.map