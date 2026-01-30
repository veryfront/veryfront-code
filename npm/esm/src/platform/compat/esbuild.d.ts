export type { BuildOptions, BuildResult, TransformOptions, TransformResult } from "esbuild";
export declare function getEsbuild(): Promise<typeof import("esbuild")>;
export declare function transform(code: string, options?: import("esbuild").TransformOptions): Promise<import("esbuild").TransformResult>;
export declare function build(options: import("esbuild").BuildOptions): Promise<import("esbuild").BuildResult>;
export declare function stop(): Promise<void>;
export declare function isEsbuildReady(): boolean;
/** Eager initialization for server startup. */
export declare function initializeEsbuild(): Promise<void>;
//# sourceMappingURL=esbuild.d.ts.map