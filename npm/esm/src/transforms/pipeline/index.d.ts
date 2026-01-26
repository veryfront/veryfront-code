import type { PipelineConfig, TransformOptions, TransformPlugin, TransformResult } from "./types.js";
export declare function runPipeline(source: string, filePath: string, projectDir: string, options: TransformOptions, config?: PipelineConfig): Promise<TransformResult>;
export declare function transformToESM(source: string, filePath: string, projectDir: string, _adapter: unknown, options: TransformOptions): Promise<string>;
export declare function getDefaultPlugins(ssr: boolean): TransformPlugin[];
export type { PipelineConfig, TransformContext, TransformOptions, TransformPlugin, TransformResult, TransformTarget, } from "./types.js";
export { TransformStage } from "./types.js";
export { createTransformContext, createTransformContextSync, isBrowser, isMDX, isSSR, isTypeScript, } from "./context.js";
//# sourceMappingURL=index.d.ts.map