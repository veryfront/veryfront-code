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
//# sourceMappingURL=runtime.d.ts.map