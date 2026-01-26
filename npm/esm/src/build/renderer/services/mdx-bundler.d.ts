import type { BundleResult, BundlerOptions, MDXBundleOptions, MDXBundleResult } from "../types/bundler-types.js";
/**
 * Bundle MDX content
 */
export declare function bundleMdx(source: {
    path: string;
    content: string;
}, options: BundlerOptions, result: BundleResult, compileMDXForImport: (source: string, options: BundlerOptions) => Promise<string>): Promise<void>;
/**
 * Bundle MDX with additional options
 */
export declare function bundleMDXWithOptions(options: MDXBundleOptions): Promise<MDXBundleResult>;
//# sourceMappingURL=mdx-bundler.d.ts.map