export interface LightningCSSTransformOptions {
    filename: string;
    code: Uint8Array;
    minify?: boolean;
    sourceMap?: boolean;
    targets?: BrowserTargets;
    analyzeDependencies?: boolean;
}
export interface LightningCSSTransformResult {
    code: Uint8Array;
    map?: Uint8Array | void;
}
export interface LightningCSSModule {
    transform: (options: LightningCSSTransformOptions) => LightningCSSTransformResult;
    default?: unknown;
}
export interface BrowserTargets {
    chrome?: number;
    firefox?: number;
    safari?: number;
    edge?: number;
}
export interface CSSOptimizationOptions {
    enabled?: boolean;
    minify?: boolean;
    autoprefixer?: boolean;
    purge?: boolean;
    criticalCSS?: boolean;
    inputFiles?: string[];
    inputDir?: string;
    outputDir?: string;
    browsers?: string[];
    purgeContent?: string[];
    sourceMap?: boolean;
}
export interface CSSBundle {
    file: string;
    content: string;
    sourceMap?: string;
    size: number;
    minifiedSize: number;
    savings: number;
}
export interface CriticalCSSResult {
    critical: string;
    remaining: string;
    criticalSize: number;
    remainingSize: number;
}
export interface CSSProcessingResult {
    code: string;
    sourceMap?: string;
}
export interface CSSOptimizationStrategy {
    readonly name: string;
    readonly priority: number;
    canProcess(options: CSSOptimizationOptions): boolean;
    process(content: string, filename: string, options: CSSOptimizationOptions): Promise<CSSProcessingResult>;
}
export interface SelectorExtractionResult {
    selectors: Set<string>;
    classes: string[];
    ids: string[];
    tags: string[];
}
export interface CSSOptimizerStats {
    totalFiles: number;
    originalSize: number;
    minifiedSize: number;
    totalSavings: number;
    averageSavings: number;
}
//# sourceMappingURL=index.d.ts.map