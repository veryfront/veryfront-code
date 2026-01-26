import type { TransformContext, TransformOptions, TransformStage } from "./types.js";
export declare function createTransformContext(source: string, filePath: string, projectDir: string, options: TransformOptions): Promise<TransformContext>;
export declare function createTransformContextSync(source: string, filePath: string, projectDir: string, contentHash: string, options: TransformOptions): TransformContext;
export declare function recordStageTiming(ctx: TransformContext, stage: TransformStage, startTime: number): void;
export declare function getTotalTiming(ctx: TransformContext): number;
export declare function formatTimingLog(ctx: TransformContext): Record<string, string>;
export declare function isSSR(ctx: TransformContext): boolean;
export declare function isBrowser(ctx: TransformContext): boolean;
export declare function isMDX(ctx: TransformContext): boolean;
export declare function isTypeScript(ctx: TransformContext): boolean;
export declare function getExtension(ctx: TransformContext): string;
//# sourceMappingURL=context.d.ts.map