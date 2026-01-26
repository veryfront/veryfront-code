export * from "./css-optimizer/index.js";
import { type CSSOptimizationOptions } from "./css-optimizer/index.js";
import { type ImageOptimizationOptions } from "./image-optimizer/index.js";
export interface TailwindBatchOptions {
    enabled?: boolean;
    projectDir: string;
    sourceDir?: string;
    outputDir?: string;
}
export interface AssetPipelineOptions {
    images?: ImageOptimizationOptions;
    css?: CSSOptimizationOptions & {
        enabled?: boolean;
    };
    tailwind?: TailwindBatchOptions;
}
export interface AssetPipelineResult {
    images: {
        optimized: number;
        variants: number;
        totalSize: number;
        enabled: boolean;
    };
    css: {
        optimized: number;
        originalSize: number;
        minifiedSize: number;
        savings: number;
        enabled: boolean;
    };
    tailwind: {
        processed: number;
        utilities: number;
        enabled: boolean;
    };
    duration: number;
}
export declare function runAssetPipeline(options?: AssetPipelineOptions): Promise<AssetPipelineResult>;
export declare function checkAssetPipelineDependencies(): Promise<{
    sharp: boolean;
    lightningCSS: boolean;
}>;
export declare function getAssetPipelineStatus(): Promise<{
    available: string[];
    missing: string[];
    recommendations: string[];
}>;
//# sourceMappingURL=index.d.ts.map