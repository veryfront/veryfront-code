import type { BundleResult, BundlerOptions } from "../types/bundler-types.js";
export declare function bundleCss(source: {
    path: string;
    content: string;
}, options: BundlerOptions, result: BundleResult): void;
export declare function processCssImports(css: string, _fromPath: string): string;
export declare function extractCssVariables(css: string): Record<string, string>;
//# sourceMappingURL=css-bundler.d.ts.map