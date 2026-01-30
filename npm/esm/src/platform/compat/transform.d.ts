/**
 * JSX/TypeScript transform using native esbuild.
 * @see ./esbuild.ts for deno compile VFS extraction
 */
export interface TransformResult {
    code: string;
}
export interface TransformOptions {
    loader?: "tsx" | "jsx" | "ts" | "js";
}
export declare function transformJsx(source: string, options?: TransformOptions): Promise<TransformResult>;
/** Call at server startup to ensure esbuild binary is available. */
export declare function initializeTransform(): Promise<void>;
export declare function isUsingEsbuild(): boolean;
//# sourceMappingURL=transform.d.ts.map