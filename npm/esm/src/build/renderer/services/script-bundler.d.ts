/**
 * JavaScript/TypeScript bundling service
 */
import type * as esbuild from "esbuild";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.js";
/**
 * Bundle JavaScript/TypeScript files
 */
export declare function bundleScript(source: {
    path: string;
    content: string;
    type: string;
}, options: BundlerOptions, result: BundleResult, esbuildInstance: typeof esbuild, fileCache: Map<string, string>): Promise<void>;
//# sourceMappingURL=script-bundler.d.ts.map